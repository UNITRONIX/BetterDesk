/**
 * Every page is in the console (web-ui), and errors the server decides on
 * show the console's error page (res.sendErrorPage). No server code renders
 * a view: a res.render() would throw, since the server has no views.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function jsFiles(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) jsFiles(full, out);
        else if (ent.name.endsWith('.js')) out.push(full);
    }
    return out;
}

test('no server code renders a view', () => {
    const files = ['routes', 'middleware', 'lib', 'services'].flatMap((d) => jsFiles(path.join(root, d)));
    files.push(path.join(root, 'server.js'));
    expect(files.length).toBeGreaterThan(50);
    const found = files
        .filter((f) => /\bres\.render\s*\(|\.render\(\s*['"`]errors\//.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(root, f));
    expect(found).toEqual([]);
});
