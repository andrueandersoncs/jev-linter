import ts from "typescript";

export interface Fragment {
  line: number;
  text: string;
}

const MAX_FRAGMENT_LENGTH = 3000;
export function extractFragments(path: string, text: string): Fragment[] {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }

  const fragments: Fragment[] = [];
  function add(raw: string, offset: number): void {
    for (let start = 0; start < raw.length;) {
      let end = Math.min(start + MAX_FRAGMENT_LENGTH, raw.length);
      if (end < raw.length) {
        const boundary = raw.lastIndexOf(" ", end);
        if (boundary > start + MAX_FRAGMENT_LENGTH / 2) end = boundary + 1;
      }
      const chunk = raw.slice(start, end);
      const piece = chunk.trim();
      if (/\p{L}/u.test(piece)) {
        let lo = 0;
        let hi = lineStarts.length;
        const position = offset + start + chunk.search(/\S/);
        while (lo + 1 < hi) {
          const middle = (lo + hi) >>> 1;
          if (lineStarts[middle]! <= position) lo = middle;
          else hi = middle;
        }
        fragments.push({ line: lo + 1, text: piece });
      }
      start = end;
    }
  }

  const scriptKind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
  const jsxRanges: { start: number; end: number }[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const modulePath = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node
        || ts.isExternalModuleReference(parent)
        || ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || parent.expression.getText(source) === "require");
      const name = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === node
        || ts.isElementAccessExpression(parent) || ts.isLiteralTypeNode(parent);
      if (!modulePath && !name) add(text.slice(node.getStart(source) + 1, node.end - 1), node.getStart(source) + 1);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const start = node.getStart(source) + 1;
      const end = node.end - (ts.isTemplateTail(node) ? 1 : 2);
      add(text.slice(start, end), start);
    } else if (ts.isJsxText(node)) {
      jsxRanges.push({ start: node.getStart(source), end: node.end });
      add(node.getText(source), node.getStart(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  let jsxIndex = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const position = scanner.getTokenPos();
      while (jsxRanges[jsxIndex] && jsxRanges[jsxIndex]!.end <= position) jsxIndex++;
      const jsx = jsxRanges[jsxIndex];
      if (!jsx || position < jsx.start) add(scanner.getTokenText(), position);
    }
  }
  return fragments.sort((left, right) => left.line - right.line);
}
