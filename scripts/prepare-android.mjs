import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), destination = path.join(root, 'android/app/src/main/assets/www');
await fs.mkdir(destination, { recursive: true });
// Build output is replaced only inside the Android generated assets directory.
const resolved = path.resolve(destination);
if (!resolved.startsWith(path.join(root, 'android/app/src/main/assets') + path.sep)) throw new Error('Invalid Android assets path');
for (const item of await fs.readdir(destination)) await fs.rm(path.join(destination, item), { recursive: true, force: true });
await fs.cp(path.join(root, 'dist'), destination, { recursive: true });
await fs.cp(path.join(root, 'examples'), path.join(destination, 'examples'), { recursive: true });
console.log('Android UI and example assets prepared.');
