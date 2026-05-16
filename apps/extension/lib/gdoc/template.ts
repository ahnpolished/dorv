export interface TemplateInput {
  title: string;
  author: string;
  prUrl: string;
  files: { filename: string; html: string }[];
}

export function generateGDocHtml(input: TemplateInput): string {
  const fileSections = input.files
    .map((f) => `<h1>${f.filename}</h1>\n${f.html}`)
    .join("\n<hr/>\n");

  return `
    <html>
      <head><meta charset="UTF-8"></head>
      <body>
        <table>
          <tr><td><b>Title</b></td><td>${input.title}</td></tr>
          <tr><td><b>Author</b></td><td>${input.author}</td></tr>
          <tr><td><b>PR</b></td><td><a href="${input.prUrl}">${input.prUrl}</a></td></tr>
        </table>
        <hr/>
        ${fileSections}
      </body>
    </html>
  `;
}
