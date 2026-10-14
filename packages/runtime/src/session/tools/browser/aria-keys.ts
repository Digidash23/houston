const QUOTED_ITEM = /^(\s*- )'(.*)$/;

/**
 * Playwright single-quotes an item's whole key when its name needs YAML
 * quoting (`- 'textbox "PIN #" [ref=e7]': 1234`, also for ": ", "{" or a
 * trailing space). Every reader here (password masking, ref stamping, the
 * tree parser) expects `- role "name" [attr]`, so a quoted line slipped
 * past all of them: its value went out unmasked and its ref unstamped.
 * Unquoted once where the tree is read; a line that does not close its
 * quote is left as printed.
 */
export function unquoteItemKeys(tree: string): string {
  return tree
    .split("\n")
    .map((line) => {
      const match = QUOTED_ITEM.exec(line);
      if (!match) return line;
      const [, head = "", body = ""] = match;
      const key = closeSingleQuoted(body);
      return key ? `${head}${key.text}${body.slice(key.end)}` : line;
    })
    .join("\n");
}

/** YAML single-quoted scalar body: `''` is a literal quote, `'` ends it. */
function closeSingleQuoted(
  body: string,
): { text: string; end: number } | undefined {
  let text = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "'") {
      text += body[i];
    } else if (body[i + 1] === "'") {
      text += "'";
      i++;
    } else {
      return { text, end: i + 1 };
    }
  }
  return undefined;
}
