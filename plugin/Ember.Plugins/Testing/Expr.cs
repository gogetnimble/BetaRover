using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using BetaRover.Ember.Json;

namespace BetaRover.Ember.Testing
{
    /// <summary>
    /// Port of engine/src/testing/expr.ts — a pragmatic evaluator for the Power
    /// Automate / Logic Apps Workflow Definition Language (WDL) expression subset
    /// the mock runner needs. Tokenizer + parser + evaluator, `?[...]` / `[...]` /
    /// `.prop` indexing, string interpolation (<c>@{…}</c>) and whole-expression
    /// strings (<c>@…</c>). Unknown functions throw so a test surfaces them.
    ///
    /// The object model matches <see cref="JsonUtil"/>: objects are
    /// Dictionary&lt;string,object&gt;, arrays are List&lt;object&gt;, numbers are
    /// double, plus string / bool / null.
    /// </summary>
    public class EvalContext
    {
        public object TriggerOutputs;
        public object TriggerBody;
        public Dictionary<string, object> Outputs = new Dictionary<string, object>();
        public Dictionary<string, object> Bodies = new Dictionary<string, object>();
        public Dictionary<string, object> Variables = new Dictionary<string, object>();
        public Dictionary<string, object> Results = new Dictionary<string, object>();
        public Dictionary<string, object> Items = new Dictionary<string, object>();
        public object CurrentItem;
        public Dictionary<string, object> Parameters;

        public static EvalContext Empty() => new EvalContext();
    }

    public static class Expr
    {
        /* ----------------------------- tokenizer ----------------------------- */
        private enum TokKind { Id, Str, Num, Punct }
        private struct Tok { public TokKind K; public string V; public Tok(TokKind k, string v) { K = k; V = v; } }

        private static bool IsIdStart(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || c == '$';
        private static bool IsIdChar(char c) => IsIdStart(c) || (c >= '0' && c <= '9');

        private static List<Tok> Tokenize(string src)
        {
            var toks = new List<Tok>();
            int i = 0, n = src.Length;
            while (i < n)
            {
                char c = src[i];
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') { i++; continue; }
                if (c == '\'')
                {
                    var s = new StringBuilder(); i++;
                    while (i < n)
                    {
                        char d = src[i];
                        if (d == '\'') { if (i + 1 < n && src[i + 1] == '\'') { s.Append('\''); i += 2; continue; } i++; break; }
                        s.Append(d); i++;
                    }
                    toks.Add(new Tok(TokKind.Str, s.ToString()));
                    continue;
                }
                if (c >= '0' && c <= '9')
                {
                    var num = new StringBuilder();
                    while (i < n && ((src[i] >= '0' && src[i] <= '9') || src[i] == '.')) { num.Append(src[i]); i++; }
                    toks.Add(new Tok(TokKind.Num, num.ToString()));
                    continue;
                }
                if (IsIdStart(c))
                {
                    var id = new StringBuilder();
                    while (i < n && IsIdChar(src[i])) { id.Append(src[i]); i++; }
                    toks.Add(new Tok(TokKind.Id, id.ToString()));
                    continue;
                }
                if (c == '?' && i + 1 < n && (src[i + 1] == '[' || src[i + 1] == '.')) { toks.Add(new Tok(TokKind.Punct, "?" + src[i + 1])); i += 2; continue; }
                if ("()[],.".IndexOf(c) >= 0) { toks.Add(new Tok(TokKind.Punct, c.ToString())); i++; continue; }
                throw new FormatException("Unexpected character '" + c + "' in expression");
            }
            return toks;
        }

        /* ------------------------------- parser ------------------------------ */
        private abstract class Ast { }
        private sealed class LitAst : Ast { public object Value; }
        private sealed class CallAst : Ast { public string Name; public List<Ast> Args; }
        private sealed class IndexAst : Ast { public Ast Target; public Ast Key; public bool Optional; }
        private sealed class PropAst : Ast { public Ast Target; public string Name; public bool Optional; }

        private sealed class Parser
        {
            private readonly List<Tok> _toks;
            private int _p;
            public Parser(List<Tok> toks) { _toks = toks; }
            private Tok? Peek() => _p < _toks.Count ? _toks[_p] : (Tok?)null;
            private Tok? Next() => _p < _toks.Count ? _toks[_p++] : (Tok?)null;
            private void Expect(string v) { var t = Next(); if (t == null || t.Value.V != v) throw new FormatException("Expected '" + v + "' in expression"); }

            private Ast ParsePrimary()
            {
                var t = Next();
                if (t == null) throw new FormatException("Unexpected end of expression");
                var tok = t.Value;
                if (tok.K == TokKind.Str) return new LitAst { Value = tok.V };
                if (tok.K == TokKind.Num) return new LitAst { Value = double.Parse(tok.V, CultureInfo.InvariantCulture) };
                if (tok.K == TokKind.Id)
                {
                    if (tok.V == "true") return new LitAst { Value = true };
                    if (tok.V == "false") return new LitAst { Value = false };
                    if (tok.V == "null") return new LitAst { Value = null };
                    Expect("(");
                    var args = new List<Ast>();
                    var pk = Peek();
                    if (pk != null && pk.Value.V != ")")
                    {
                        args.Add(ParseExpr());
                        pk = Peek();
                        while (pk != null && pk.Value.V == ",") { Next(); args.Add(ParseExpr()); pk = Peek(); }
                    }
                    Expect(")");
                    return new CallAst { Name = tok.V, Args = args };
                }
                throw new FormatException("Unexpected token '" + tok.V + "' in expression");
            }

            public Ast ParseExpr()
            {
                Ast node = ParsePrimary();
                var pk = Peek();
                while (pk != null)
                {
                    string v = pk.Value.V;
                    if (v == "[" || v == "?[") { bool optional = v == "?["; Next(); var key = ParseExpr(); Expect("]"); node = new IndexAst { Target = node, Key = key, Optional = optional }; }
                    else if (v == "." || v == "?.") { bool optional = v == "?."; Next(); var id = Next(); if (id == null) throw new FormatException("Expected property name"); node = new PropAst { Target = node, Name = id.Value.V, Optional = optional }; }
                    else break;
                    pk = Peek();
                }
                return node;
            }

            public bool AtEnd => _p == _toks.Count;
        }

        private static Ast Parse(string src)
        {
            var parser = new Parser(Tokenize(src));
            var ast = parser.ParseExpr();
            if (!parser.AtEnd) throw new FormatException("Trailing tokens in expression");
            return ast;
        }

        /* ---------------------------- evaluation ----------------------------- */
        public static bool DeepEqual(object a, object b)
        {
            if (a == null && b == null) return true;
            if (a == null || b == null) return false;
            if (a is string sa && b is string sb) return sa == sb;
            if (a is bool ba && b is bool bb) return ba == bb;
            if (a is double da && b is double db) return da == db;
            bool aObj = a is Dictionary<string, object> || a is List<object>;
            bool bObj = b is Dictionary<string, object> || b is List<object>;
            if (aObj && bObj) return JsonUtil.Serialize(a) == JsonUtil.Serialize(b);
            return false;
        }

        public static string ToStr(object v)
        {
            if (v == null) return "";
            if (v is string s) return s;
            if (v is bool b) return b ? "true" : "false";
            if (v is double d) return NumStr(d);
            return JsonUtil.Serialize(v);
        }

        private static string NumStr(double d)
        {
            if (!double.IsInfinity(d) && !double.IsNaN(d) && d == Math.Floor(d))
                return ((long)d).ToString(CultureInfo.InvariantCulture);
            return d.ToString("R", CultureInfo.InvariantCulture);
        }

        public static double ToNum(object v)
        {
            if (v is double d) return d;
            if (v is bool b) return b ? 1 : 0;
            if (v == null) return 0;
            string s = v is string str ? str : ToStr(v);
            if (string.IsNullOrEmpty(s.Trim())) return 0;
            double r;
            return double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out r) ? r : double.NaN;
        }

        public static bool ToBool(object v)
        {
            if (v is bool b) return b;
            if (v is string s) return s.ToLowerInvariant() == "true";
            if (v == null) return false;
            if (v is double d) return d != 0 && !double.IsNaN(d);
            return true;
        }

        private static bool IsEmpty(object v)
        {
            if (v == null) return true;
            if (v is string s) return s.Length == 0;
            if (v is List<object> arr) return arr.Count == 0;
            if (v is Dictionary<string, object> obj) return obj.Count == 0;
            return false;
        }

        private delegate object Fn(EvalContext c, List<object> a);
        private static readonly Dictionary<string, Fn> Functions = BuildFunctions();

        private static object Arg(List<object> a, int i) => i < a.Count ? a[i] : null;

        private static Dictionary<string, Fn> BuildFunctions()
        {
            var f = new Dictionary<string, Fn>();
            // references
            f["variables"] = (c, a) => Val(c.Variables, Str0(a));
            f["outputs"] = (c, a) => Val(c.Outputs, Str0(a));
            f["body"] = (c, a) => Val(c.Bodies, Str0(a));
            f["triggeroutputs"] = (c, a) => c.TriggerOutputs;
            f["triggerbody"] = (c, a) => c.TriggerBody;
            f["trigger"] = (c, a) => new Dictionary<string, object> { { "outputs", c.TriggerOutputs } };
            f["item"] = (c, a) => c.CurrentItem;
            f["items"] = (c, a) => Val(c.Items, Str0(a));
            f["result"] = (c, a) => Val(c.Results, Str0(a));
            f["parameters"] = (c, a) => c.Parameters != null ? Val(c.Parameters, Str0(a)) : null;
            f["actions"] = (c, a) => new Dictionary<string, object> { { "outputs", Val(c.Outputs, Str0(a)) }, { "body", Val(c.Bodies, Str0(a)) } };
            // conversion
            f["string"] = (c, a) => ToStr(Arg(a, 0));
            f["int"] = (c, a) => Math.Truncate(ToNum(Arg(a, 0)));
            f["float"] = (c, a) => ToNum(Arg(a, 0));
            f["bool"] = (c, a) => ToBool(Arg(a, 0));
            f["json"] = (c, a) => Arg(a, 0) is string js ? JsonUtil.Parse(js) : Arg(a, 0);
            f["array"] = (c, a) => Arg(a, 0) is List<object> l ? (object)l : new List<object> { Arg(a, 0) };
            f["createarray"] = (c, a) => new List<object>(a);
            // logic
            f["if"] = (c, a) => ToBool(Arg(a, 0)) ? Arg(a, 1) : Arg(a, 2);
            f["equals"] = (c, a) => DeepEqual(Arg(a, 0), Arg(a, 1));
            f["not"] = (c, a) => !ToBool(Arg(a, 0));
            f["and"] = (c, a) => a.TrueForAll(ToBool);
            f["or"] = (c, a) => a.Exists(ToBool);
            f["greater"] = (c, a) => ToNum(Arg(a, 0)) > ToNum(Arg(a, 1));
            f["greaterorequals"] = (c, a) => ToNum(Arg(a, 0)) >= ToNum(Arg(a, 1));
            f["less"] = (c, a) => ToNum(Arg(a, 0)) < ToNum(Arg(a, 1));
            f["lessorequals"] = (c, a) => ToNum(Arg(a, 0)) <= ToNum(Arg(a, 1));
            f["coalesce"] = (c, a) => a.Find(x => x != null);
            f["empty"] = (c, a) => IsEmpty(Arg(a, 0));
            // string
            f["concat"] = (c, a) => { var sb = new StringBuilder(); foreach (var x in a) sb.Append(ToStr(x)); return sb.ToString(); };
            f["tolower"] = (c, a) => ToStr(Arg(a, 0)).ToLowerInvariant();
            f["toupper"] = (c, a) => ToStr(Arg(a, 0)).ToUpperInvariant();
            f["trim"] = (c, a) => ToStr(Arg(a, 0)).Trim();
            f["replace"] = (c, a) => ToStr(Arg(a, 0)).Replace(ToStr(Arg(a, 1)), ToStr(Arg(a, 2)));
            f["substring"] = (c, a) => Substr(ToStr(Arg(a, 0)), ToNum(Arg(a, 1)), Arg(a, 2) == null ? (double?)null : ToNum(Arg(a, 2)));
            f["startswith"] = (c, a) => ToStr(Arg(a, 0)).StartsWith(ToStr(Arg(a, 1)), StringComparison.Ordinal);
            f["endswith"] = (c, a) => ToStr(Arg(a, 0)).EndsWith(ToStr(Arg(a, 1)), StringComparison.Ordinal);
            f["indexof"] = (c, a) => (double)ToStr(Arg(a, 0)).IndexOf(ToStr(Arg(a, 1)), StringComparison.Ordinal);
            f["guid"] = (c, a) => "00000000-0000-0000-0000-000000000000";
            // collection
            f["length"] = (c, a) => Arg(a, 0) is List<object> l ? (double)l.Count : (double)ToStr(Arg(a, 0)).Length;
            f["first"] = (c, a) => Arg(a, 0) is List<object> l ? (l.Count > 0 ? l[0] : null) : FirstChar(ToStr(Arg(a, 0)));
            f["last"] = (c, a) => Arg(a, 0) is List<object> l ? (l.Count > 0 ? l[l.Count - 1] : null) : LastChar(ToStr(Arg(a, 0)));
            f["contains"] = (c, a) =>
            {
                var hay = Arg(a, 0); var needle = Arg(a, 1);
                if (hay is List<object> l) return l.Exists(x => DeepEqual(x, needle));
                if (hay is Dictionary<string, object> o) return o.ContainsKey(ToStr(needle));
                return ToStr(hay).IndexOf(ToStr(needle), StringComparison.Ordinal) >= 0;
            };
            // math
            f["add"] = (c, a) => ToNum(Arg(a, 0)) + ToNum(Arg(a, 1));
            f["sub"] = (c, a) => ToNum(Arg(a, 0)) - ToNum(Arg(a, 1));
            f["mul"] = (c, a) => ToNum(Arg(a, 0)) * ToNum(Arg(a, 1));
            f["div"] = (c, a) => ToNum(Arg(a, 0)) / ToNum(Arg(a, 1));
            f["mod"] = (c, a) => ToNum(Arg(a, 0)) % ToNum(Arg(a, 1));
            f["max"] = (c, a) => { double m = double.NegativeInfinity; foreach (var x in a) m = Math.Max(m, ToNum(x)); return m; };
            f["min"] = (c, a) => { double m = double.PositiveInfinity; foreach (var x in a) m = Math.Min(m, ToNum(x)); return m; };
            // deterministic time (documented): fixed so tests are repeatable
            f["utcnow"] = (c, a) => "2020-01-01T00:00:00Z";
            return f;
        }

        private static string Str0(List<object> a) => ToStr(Arg(a, 0));
        private static object Val(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) ? v : null; }
        private static object FirstChar(string s) => s.Length > 0 ? s.Substring(0, 1) : null;
        private static object LastChar(string s) => s.Length > 0 ? s.Substring(s.Length - 1, 1) : null;

        private static string Substr(string s, double start, double? length)
        {
            int st = (int)start;
            if (st < 0) st = 0;
            if (st >= s.Length) return "";
            if (length == null) return s.Substring(st);
            int len = (int)length.Value;
            if (len < 0) len = 0;
            if (st + len > s.Length) len = s.Length - st;
            return s.Substring(st, len);
        }

        private static object EvalAst(Ast ast, EvalContext ctx)
        {
            if (ast is LitAst lit) return lit.Value;
            if (ast is CallAst call)
            {
                Fn fn;
                if (!Functions.TryGetValue(call.Name.ToLowerInvariant(), out fn))
                    throw new FormatException("Unsupported function '" + call.Name + "()'");
                var args = new List<object>(call.Args.Count);
                foreach (var a in call.Args) args.Add(EvalAst(a, ctx));
                return fn(ctx, args);
            }
            if (ast is IndexAst idx)
            {
                var target = EvalAst(idx.Target, ctx);
                if (target == null) return null;
                var key = EvalAst(idx.Key, ctx);
                return Member(target, key);
            }
            if (ast is PropAst prop)
            {
                var target = EvalAst(prop.Target, ctx);
                if (target == null) return null;
                return Member(target, prop.Name);
            }
            return null;
        }

        private static object Member(object target, object key)
        {
            if (target is Dictionary<string, object> obj)
            {
                object v; return obj.TryGetValue(ToStr(key), out v) ? v : null;
            }
            if (target is List<object> arr)
            {
                double n = ToNum(key);
                int i = (int)n;
                return (!double.IsNaN(n) && i >= 0 && i < arr.Count) ? arr[i] : null;
            }
            if (target is string str)
            {
                double n = ToNum(key);
                int i = (int)n;
                return (!double.IsNaN(n) && i >= 0 && i < str.Length) ? (object)str.Substring(i, 1) : null;
            }
            return null;
        }

        /// <summary>Evaluate a single WDL expression body (the text after <c>@</c>).</summary>
        public static object EvaluateExpression(string expr, EvalContext ctx) => EvalAst(Parse(expr), ctx);

        /// <summary>
        /// Resolve a value from a flow definition: strings may be literals, whole
        /// expressions (<c>@expr</c>), interpolations (<c>text @{expr} text</c>) or
        /// escaped (<c>@@literal</c>). Objects/arrays resolve deeply.
        /// </summary>
        public static object ResolveValue(object value, EvalContext ctx)
        {
            if (value is List<object> arr)
            {
                var outArr = new List<object>(arr.Count);
                foreach (var v in arr) outArr.Add(ResolveValue(v, ctx));
                return outArr;
            }
            if (value is Dictionary<string, object> obj)
            {
                var outObj = new Dictionary<string, object>();
                foreach (var kv in obj) outObj[kv.Key] = ResolveValue(kv.Value, ctx);
                return outObj;
            }
            if (!(value is string s)) return value;
            if (s.StartsWith("@@")) return s.Substring(1);
            if (s.StartsWith("@") && !s.StartsWith("@{")) return EvaluateExpression(s.Substring(1), ctx);
            if (s.IndexOf("@{", StringComparison.Ordinal) < 0) return s;
            // interpolation
            var sb = new StringBuilder();
            int i = 0;
            while (i < s.Length)
            {
                if (s[i] == '@' && i + 1 < s.Length && s[i + 1] == '@') { sb.Append('@'); i += 2; continue; }
                if (s[i] == '@' && i + 1 < s.Length && s[i + 1] == '{')
                {
                    int depth = 1, j = i + 2; var expr = new StringBuilder();
                    while (j < s.Length && depth > 0)
                    {
                        if (s[j] == '{') depth++;
                        else if (s[j] == '}') { depth--; if (depth == 0) break; }
                        expr.Append(s[j++]);
                    }
                    sb.Append(ToStr(EvaluateExpression(expr.ToString(), ctx)));
                    i = j + 1;
                    continue;
                }
                sb.Append(s[i++]);
            }
            return sb.ToString();
        }
    }
}
