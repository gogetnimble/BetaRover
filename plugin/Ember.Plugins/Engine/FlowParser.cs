using System.Collections.Generic;
using BetaRover.Ember.Json;

namespace BetaRover.Ember.Engine
{
    /// <summary>Port of engine/src/flowModel.ts — parses clientdata into a FlowModel.</summary>
    public static class FlowParser
    {
        private static Dictionary<string, object> AsRecord(object v) => JsonUtil.AsObject(v);

        /// <summary>
        /// clientdata appears as { properties: { definition, connectionReferences } },
        /// { definition }, a bare definition, or any of these as a JSON string.
        /// </summary>
        private static void Unwrap(object clientData, out Dictionary<string, object> definition, out Dictionary<string, object> connRefs)
        {
            object root = clientData;
            if (root is string str)
            {
                try { root = JsonUtil.Parse(str); } catch { root = new Dictionary<string, object>(); }
            }
            var obj = AsRecord(root);
            var props = AsRecord(JsonUtil.Get(obj, "properties"));

            object def = JsonUtil.Get(props, "definition") ?? JsonUtil.Get(obj, "definition");
            if (def == null && (JsonUtil.Get(obj, "triggers") != null || JsonUtil.Get(obj, "actions") != null)) def = obj;
            definition = AsRecord(def);
            connRefs = AsRecord(JsonUtil.Get(props, "connectionReferences") ?? JsonUtil.Get(obj, "connectionReferences"));
        }

        private static Dictionary<string, List<string>> NormaliseRunAfter(object raw)
        {
            var outMap = new Dictionary<string, List<string>>();
            foreach (var kv in AsRecord(raw))
            {
                var list = new List<string>();
                if (kv.Value is List<object> arr)
                    foreach (var s in arr) list.Add(JsonUtil.Str(s));
                outMap[kv.Key] = list;
            }
            return outMap;
        }

        private static List<FlowAction> WalkActions(object actionsMap, string parentPath, List<FlowAction> flat)
        {
            var result = new List<FlowAction>();
            foreach (var kv in AsRecord(actionsMap))
            {
                string name = kv.Key;
                var action = AsRecord(kv.Value);
                string path = string.IsNullOrEmpty(parentPath) ? name : parentPath + "/" + name;

                var children = new List<FlowAction>();
                var nested = new List<object> { JsonUtil.Get(action, "actions") };
                var elseBranch = AsRecord(JsonUtil.Get(action, "else"));
                nested.Add(JsonUtil.Get(elseBranch, "actions"));
                foreach (var c in AsRecord(JsonUtil.Get(action, "cases")).Values)
                    nested.Add(JsonUtil.Get(AsRecord(c), "actions"));
                nested.Add(JsonUtil.Get(AsRecord(JsonUtil.Get(action, "default")), "actions"));

                var node = new FlowAction
                {
                    Name = name,
                    Type = JsonUtil.Str(JsonUtil.Get(action, "type") ?? "Unknown"),
                    RunAfter = NormaliseRunAfter(JsonUtil.Get(action, "runAfter")),
                    Inputs = JsonUtil.Get(action, "inputs"),
                    Path = path,
                    Children = children,
                    Raw = action,
                };
                flat.Add(node);
                foreach (var n in nested)
                    if (n != null) children.AddRange(WalkActions(n, path, flat));
                result.Add(node);
            }
            return result;
        }

        public static FlowModel ParseFlow(string displayName, object clientData)
        {
            Dictionary<string, object> definition, connRefs;
            Unwrap(clientData, out definition, out connRefs);

            var triggers = new List<FlowTrigger>();
            foreach (var kv in AsRecord(JsonUtil.Get(definition, "triggers")))
            {
                var t = AsRecord(kv.Value);
                triggers.Add(new FlowTrigger
                {
                    Name = kv.Key,
                    Type = JsonUtil.Str(JsonUtil.Get(t, "type") ?? "Unknown"),
                    Inputs = JsonUtil.Get(t, "inputs"),
                    Raw = t,
                });
            }

            var flat = new List<FlowAction>();
            var top = WalkActions(JsonUtil.Get(definition, "actions"), "", flat);

            return new FlowModel
            {
                DisplayName = displayName,
                Triggers = triggers,
                TopLevelActions = top,
                AllActions = flat,
                ConnectionReferences = connRefs,
                Raw = definition,
            };
        }
    }
}
