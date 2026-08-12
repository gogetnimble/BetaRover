using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace BetaRover.Ember.Json
{
    /// <summary>
    /// A tiny, dependency-free JSON parser + serializer. Dataverse plug-ins run in
    /// a sandbox with no Newtonsoft, so the engine uses this instead of an external
    /// package (which keeps the whole thing shippable as one solution component).
    ///
    /// Object model: objects are <see cref="Dictionary{TKey,TValue}"/> (string→object),
    /// arrays are <see cref="List{T}"/> of object, numbers are double, plus string,
    /// bool and null. This mirrors the JS object model the TypeScript engine assumes.
    /// </summary>
    public static class JsonUtil
    {
        // ---- parse ----
        public static object Parse(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            int i = 0;
            var v = ParseValue(text, ref i);
            SkipWs(text, ref i);
            return v;
        }

        /// <summary>Parse, returning an object dictionary ({} on anything else).</summary>
        public static Dictionary<string, object> ParseObject(string text)
        {
            return Parse(text) as Dictionary<string, object> ?? new Dictionary<string, object>();
        }

        private static object ParseValue(string s, ref int i)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) throw new FormatException("Unexpected end of JSON");
            char c = s[i];
            switch (c)
            {
                case '{': return ParseObject(s, ref i);
                case '[': return ParseArray(s, ref i);
                case '"': return ParseString(s, ref i);
                case 't': Expect(s, ref i, "true"); return true;
                case 'f': Expect(s, ref i, "false"); return false;
                case 'n': Expect(s, ref i, "null"); return null;
                default: return ParseNumber(s, ref i);
            }
        }

        private static Dictionary<string, object> ParseObject(string s, ref int i)
        {
            var obj = new Dictionary<string, object>();
            i++; // {
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return obj; }
            while (true)
            {
                SkipWs(s, ref i);
                string key = ParseString(s, ref i);
                SkipWs(s, ref i);
                if (i >= s.Length || s[i] != ':') throw new FormatException("Expected ':' in object");
                i++;
                object val = ParseValue(s, ref i);
                obj[key] = val;
                SkipWs(s, ref i);
                if (i >= s.Length) throw new FormatException("Unterminated object");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == '}') { i++; break; }
                throw new FormatException("Expected ',' or '}' in object");
            }
            return obj;
        }

        private static List<object> ParseArray(string s, ref int i)
        {
            var arr = new List<object>();
            i++; // [
            SkipWs(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return arr; }
            while (true)
            {
                object val = ParseValue(s, ref i);
                arr.Add(val);
                SkipWs(s, ref i);
                if (i >= s.Length) throw new FormatException("Unterminated array");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == ']') { i++; break; }
                throw new FormatException("Expected ',' or ']' in array");
            }
            return arr;
        }

        private static string ParseString(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("Expected string");
            i++;
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c == '\\')
                {
                    if (i >= s.Length) break;
                    char e = s[i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            var hex = s.Substring(i, 4); i += 4;
                            sb.Append((char)int.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            break;
                        default: sb.Append(e); break;
                    }
                }
                else sb.Append(c);
            }
            throw new FormatException("Unterminated string");
        }

        private static object ParseNumber(string s, ref int i)
        {
            int start = i;
            while (i < s.Length && "-+.eE0123456789".IndexOf(s[i]) >= 0) i++;
            string num = s.Substring(start, i - start);
            return double.Parse(num, CultureInfo.InvariantCulture);
        }

        private static void Expect(string s, ref int i, string literal)
        {
            if (i + literal.Length > s.Length || s.Substring(i, literal.Length) != literal)
                throw new FormatException("Expected '" + literal + "'");
            i += literal.Length;
        }

        private static void SkipWs(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
        }

        // ---- serialize ----
        public static string Serialize(object value)
        {
            var sb = new StringBuilder();
            Write(sb, value);
            return sb.ToString();
        }

        private static void Write(StringBuilder sb, object v)
        {
            if (v == null) { sb.Append("null"); return; }
            switch (v)
            {
                case string s: WriteString(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); break;
                case int n: sb.Append(n.ToString(CultureInfo.InvariantCulture)); break;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); break;
                case IDictionary<string, object> obj:
                    sb.Append('{');
                    bool first = true;
                    foreach (var kv in obj)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, kv.Key);
                        sb.Append(':');
                        Write(sb, kv.Value);
                    }
                    sb.Append('}');
                    break;
                case System.Collections.IEnumerable arr:
                    sb.Append('[');
                    bool f2 = true;
                    foreach (var item in arr)
                    {
                        if (!f2) sb.Append(',');
                        f2 = false;
                        Write(sb, item);
                    }
                    sb.Append(']');
                    break;
                default:
                    WriteString(sb, v.ToString());
                    break;
            }
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ---- accessors (mirror the TS asRecord / string coercions) ----
        public static Dictionary<string, object> AsObject(object v) =>
            v as Dictionary<string, object> ?? new Dictionary<string, object>();

        public static List<object> AsArray(object v) =>
            v as List<object> ?? new List<object>();

        public static object Get(object obj, string key)
        {
            var d = obj as Dictionary<string, object>;
            if (d != null && d.TryGetValue(key, out var val)) return val;
            return null;
        }

        public static string Str(object v)
        {
            if (v == null) return "";
            if (v is string s) return s;
            if (v is bool b) return b ? "true" : "false";
            if (v is double d) return d == Math.Floor(d) && !double.IsInfinity(d)
                ? ((long)d).ToString(CultureInfo.InvariantCulture)
                : d.ToString("R", CultureInfo.InvariantCulture);
            return Serialize(v);
        }
    }
}
