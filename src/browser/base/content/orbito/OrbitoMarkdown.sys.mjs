/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Markdown converter shared by the panel (assistant.js) and the document
 * pages (OrbitoDocuments.sys.mjs), so that a reply and a document look the
 * same. It builds elements in the document it is given and puts all text in
 * with textContent, so markup in the source stays text.
 *
 * Chrome-free: it only uses the document passed in.
 */

const XHTML = "http://www.w3.org/1999/xhtml";

/** An <a href> that opens in a new tab, for pages without chrome privileges. */
export function plainLink(doc, href, label) {
  let a = doc.createElementNS(XHTML, "a");
  a.href = href;
  a.title = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.append(...label);
  return a;
}

/**
 * Renders model output as Markdown: headings, lists, quotes, tables, code,
 * rules, and inline emphasis, code and links. Images become links, and only
 * http(s) links are made. Must not throw on text cut off mid-stream.
 *
 * @param {Document} doc The document to create the elements in.
 * @param {string} text
 * @param {object} [options]
 * @param {Function} [options.link] (href, labelNodes) => the link element;
 *   plainLink by default.
 * @returns {Element[]} The blocks.
 */
export function markdown(
  doc,
  text,
  { link = (href, label) => plainLink(doc, href, label) } = {}
) {
  let el = (tag, props = {}, children = []) => {
    let node = doc.createElementNS(XHTML, tag);
    for (let [key, value] of Object.entries(props)) {
      if (key == "text") {
        node.textContent = value;
      } else {
        node.setAttribute(key, value);
      }
    }
    node.append(...children);
    return node;
  };
  let lines = text.replace(/\t/g, "    ").split("\n");

  let wrap = tag => (m, inLink) => [el(tag, {}, inline(m[1], inLink))];
  let url = String.raw`https?:\/\/`;
  // Tried at each position in order; the earliest match wins.
  let rules = [
    [/\\([!-/:-@[-`{-~])/g, m => [m[1]]],
    [/(`+)(.+?)\1(?!`)/g, m => [el("code", { text: m[2] })]],
    [
      new RegExp(
        String.raw`!?\[([^\]]*)\]\((${url}[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?: +"[^"]*")?\)`,
        "g"
      ),
      (m, inLink) =>
        inLink ? inline(m[1], true) : [link(m[2], inline(m[1] || m[2], true))],
    ],
    [
      new RegExp(
        String.raw`<(${url}[^\s<>]+)>|${url}[\w\-.~:/?#[\]@!$&'()*+,;=%]*[\w\-~/#=&%+]`,
        "g"
      ),
      (m, inLink) => (inLink ? [m[0]] : [link(m[1] || m[0], [m[1] || m[0]])]),
    ],
    [
      /\*\*\*(?=\S)(.*?\S)\*\*\*/g,
      (m, inLink) => [el("strong", {}, [el("em", {}, inline(m[1], inLink))])],
    ],
    [/\*\*(?=\S)(.*?\S)\*\*/g, wrap("strong")],
    [/(?<![\p{L}\p{N}_])__(?=\S)(.*?\S)__(?![\p{L}\p{N}_])/gu, wrap("strong")],
    [/~~(?=\S)(.*?\S)~~/g, wrap("del")],
    [/\*([^\s*](?:.*?[^\s*])?)\*/g, wrap("em")],
    [/(?<![\p{L}\p{N}_])_([^\s_](?:.*?[^\s_])?)_(?![\p{L}\p{N}_])/gu, wrap("em")],
  ];
  let inline = (source, inLink = false) => {
    let nodes = [];
    let found = rules.map(() => undefined);
    let pos = 0;
    for (;;) {
      let best = -1;
      for (let [k, [re]] of rules.entries()) {
        if (found[k] !== null && !(found[k]?.index >= pos)) {
          re.lastIndex = pos;
          found[k] = re.exec(source);
        }
        if (found[k] && (best < 0 || found[k].index < found[best].index)) {
          best = k;
        }
      }
      if (best < 0) {
        break;
      }
      let match = found[best];
      let [, render] = rules[best];
      nodes.push(source.slice(pos, match.index), ...render(match, inLink));
      pos = match.index + match[0].length;
    }
    nodes.push(source.slice(pos));
    return nodes.filter(node => node !== "");
  };
  // Soft line breaks become spaces; two trailing spaces or "\" a <br>.
  let paragraph = paragraphLines =>
    paragraphLines.flatMap((line, n) => {
      let hard = /( {2,}|\\)$/.test(line);
      let nodes = inline(line.trim().replace(/\\$/, ""));
      if (n == paragraphLines.length - 1) {
        return nodes;
      }
      return [...nodes, hard ? el("br") : " "];
    });

  let indent = line => line.match(/^ */)[0].length;
  let fenceOf = line => line.match(/^ *(`{3,}|~{3,})/)?.[1];
  let headingOf = line => line.match(/^ {0,3}(#{1,6}) +(.*?)(?: +#+)? *$/);
  let isRule = line => /^ {0,3}([-*_])( *\1){2,} *$/.test(line);
  let quote = /^ {0,3}> ?/;
  let bulletOf = line =>
    !isRule(line) && line.match(/^( *)([-*+]|(\d{1,9})[.)])( +|$)(.*)/);
  let cells = line =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/(?<!\\)\|$/, "")
      .split(/(?<!\\)\|/)
      .map(cell => cell.trim().replace(/\\\|/g, "|"));
  let isTable = i =>
    lines[i].includes("|") &&
    i + 1 < lines.length &&
    /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/.test(lines[i + 1]) &&
    cells(lines[i]).length == cells(lines[i + 1]).length;
  let startsBlock = i => {
    let bullet = bulletOf(lines[i]);
    return !!(
      fenceOf(lines[i]) ||
      headingOf(lines[i]) ||
      isRule(lines[i]) ||
      quote.test(lines[i]) ||
      // Only "1." starts a list mid-paragraph, so "2024. 10. 21." is prose.
      (bullet && (!bullet[3] || +bullet[3] == 1)) ||
      isTable(i)
    );
  };

  // A list starting at line `at`, nested lists and all; returns the line
  // after it.
  let list = (into, at) => {
    let first = bulletOf(lines[at]);
    let ordered = !!first[3];
    let base = first[1].length;
    let node = el(ordered ? "ol" : "ul");
    if (ordered && +first[3] != 1) {
      node.setAttribute("start", +first[3]);
    }
    into.push(node);
    for (;;) {
      let bullet = bulletOf(lines[at]);
      let contentIndent =
        bullet[1].length + bullet[2].length + Math.max(1, bullet[4].length);
      let body = [bullet[5]];
      let loose = false;
      for (at++; at < lines.length; at++) {
        let line = lines[at];
        if (!line.trim()) {
          let after = at + 1;
          while (after < lines.length && !lines[after].trim()) {
            after++;
          }
          if (after == lines.length || indent(lines[after]) < base + 2) {
            break;
          }
          body.push("");
          loose = true;
        } else if (indent(line) >= base + 2) {
          body.push(line.replace(new RegExp(`^ {0,${contentIndent}}`), ""));
        } else if (
          body.at(-1) !== "" &&
          !startsBlock(at) &&
          !bulletOf(line)
        ) {
          body.push(line.trim());
        } else {
          break;
        }
      }
      let content = markdown(doc, body.join("\n"), { link });
      node.append(
        el(
          "li",
          {},
          loose
            ? content
            : content.flatMap(block =>
                block.localName == "p" ? [...block.childNodes] : [block]
              )
        )
      );

      let next = at;
      while (next < lines.length && !lines[next].trim()) {
        next++;
      }
      let sibling = next < lines.length && bulletOf(lines[next]);
      if (!sibling || !!sibling[3] != ordered) {
        return at;
      }
      at = next;
    }
  };

  let blocks = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    let fence = fenceOf(line);
    let heading = headingOf(line);
    if (fence) {
      let close = new RegExp(`^ *${fence[0]}{${fence.length},} *$`);
      let strip = new RegExp(`^ {0,${indent(line)}}`);
      let code = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) {
        code.push(lines[i].replace(strip, ""));
      }
      i++;
      blocks.push(el("pre", {}, [el("code", { text: code.join("\n") })]));
    } else if (!line.trim()) {
      i++;
    } else if (heading) {
      let tag = ["h3", "h3", "h4", "h5", "h5", "h5"][heading[1].length - 1];
      blocks.push(el(tag, {}, inline(heading[2])));
      i++;
    } else if (isRule(line)) {
      blocks.push(el("hr"));
      i++;
    } else if (quote.test(line)) {
      let quoted = [];
      for (; i < lines.length && quote.test(lines[i]); i++) {
        quoted.push(lines[i].replace(quote, ""));
      }
      blocks.push(
        el("blockquote", {}, markdown(doc, quoted.join("\n"), { link }))
      );
    } else if (isTable(i)) {
      let aligns = cells(lines[i + 1]).map(cell => {
        if (cell.endsWith(":")) {
          return cell.startsWith(":") ? "center" : "right";
        }
        return cell.startsWith(":") ? "left" : "";
      });
      let row = (rowLine, tag) => {
        let values = cells(rowLine);
        return el(
          "tr",
          {},
          aligns.map((align, n) => {
            let cell = el(tag, {}, inline(values[n] ?? ""));
            cell.style.textAlign = align;
            return cell;
          })
        );
      };
      let head = el("thead", {}, [row(line, "th")]);
      let rows = [];
      for (i += 2; i < lines.length && lines[i].includes("|"); i++) {
        rows.push(row(lines[i], "td"));
      }
      blocks.push(el("table", {}, [head, el("tbody", {}, rows)]));
    } else if (bulletOf(line)) {
      i = list(blocks, i);
    } else {
      let paragraphLines = [line];
      for (i++; i < lines.length && lines[i].trim() && !startsBlock(i); i++) {
        paragraphLines.push(lines[i]);
      }
      blocks.push(el("p", {}, paragraph(paragraphLines)));
    }
  }
  return blocks;
}
