import { defineRule, type ESTree } from "@oxlint/plugins";
import allowlist from "./cjk-allowlist.json" with { type: "json" };

const FILE = /(?:^|\/)(apps\/web\/src\/.*\.[cm]?[jt]sx?)$/u;
const EXCLUDED =
  /(?:\/i18n\/|\/(?:__tests__|fixtures|__fixtures__)\/|\.(?:test|spec|stories|fixture)\.)/u;
const HAN = /\p{Script=Han}/u;

function key(kind: string, text: string): string {
  return JSON.stringify([kind, text]);
}

export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Keep Chinese UI copy in the shipped translation catalog." },
  },
  create(context) {
    const path = FILE.exec(context.filename.replaceAll("\\", "/"))?.[1];
    if (!path || EXCLUDED.test(path)) return {};
    const exceptions = new Map(
      allowlist
        .filter((row) => row.path === path)
        .map((row) => [key(row.kind, row.text), row.count]),
    );
    const check = (node: ESTree.Node, kind: string, text: string | null | undefined) => {
      if (!text || !HAN.test(text)) return;
      const entry = key(kind, text);
      const remaining = exceptions.get(entry) ?? 0;
      if (remaining > 0) {
        exceptions.set(entry, remaining - 1);
        return;
      }
      context.report({
        node,
        message: "Use uiText with English source copy and add its zhCN translation.",
      });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") {
          const kind =
            node.parent.type === "JSXAttribute"
              ? "attribute"
              : node.parent.type === "Property" && node.parent.key === node
                ? "key"
                : "string";
          check(node, kind, node.value);
        } else if ("regex" in node) {
          check(node, "regexp", node.raw);
        }
      },
      TemplateElement(node) {
        const single = node.parent.type === "TemplateLiteral" && node.parent.quasis.length === 1;
        check(node, single ? "string" : "template", node.value.cooked);
      },
      JSXText(node) {
        check(node, "jsx", node.value);
      },
      Property(node) {
        if (node.key.type === "Identifier") check(node.key, "key", node.key.name);
      },
    };
  },
});
