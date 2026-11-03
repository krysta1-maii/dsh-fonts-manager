import { readFile, writeFile, mkdir, lstat, realpath, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const sourceRoot = await realpath(resolve(import.meta.dirname, '..'));
const targetRoot = await realpath('/home/andyk/.dsh-local-plugins/dsh-fonts-manager');
if (sourceRoot !== '/home/andyk/projects-dsh/dsh-fonts-manager' || targetRoot !== '/home/andyk/.dsh-local-plugins/dsh-fonts-manager') throw new Error('Unexpected source or installation root');
const files = ['package.json', 'locale/zh.json', 'locale/en.json', 'locale/ja.json', 'locale/es.json', 'locale/fr.json',
  'locale/de.json', 'locale/ru.json', 'locale/pt.json', 'src/client.js', 'src/styles.css', 'src/preview.css',
  'test/preview.test.js', 'test/sections.test.js', 'test/redesign.test.js', 'test/browser-entry.jsx',
  'scripts/browser-driver.mjs', 'scripts/test-browser.mjs', 'README.md', 'VERIFICATION.md', '.gitignore', 'client.js'];
const hash = data => createHash('sha256').update(data).digest('hex');
async function optional(path) { try { return await readFile(path); } catch(error) { if(error.code==='ENOENT') return null; throw error; } }
const sourceManifest = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
const targetManifest = JSON.parse(await readFile(join(targetRoot, 'package.json'), 'utf8'));
if (sourceManifest.name !== '@local/dsh-fonts-manager' || targetManifest.name !== sourceManifest.name) throw new Error('Package identity mismatch');
for(const field of ['exports','dsh','engines'])if(JSON.stringify(sourceManifest[field])!==JSON.stringify(targetManifest[field]))throw new Error('Only browser updates are supported: '+field);
const protectedFiles={};
for(const file of ['index.js','shared.js','cordis.patch.yml']){
  const a=await readFile(join(sourceRoot,file)),b=await readFile(join(targetRoot,file));
  if(!a.equals(b))throw new Error('Host/config file differs: '+file);
  protectedFiles[file]=hash(b);
}
const backup=join(sourceRoot,'.release-backups','installed-before-'+sourceManifest.version);await mkdir(backup,{recursive:true});
const manifestPath=join(backup,'backup-manifest.json');
const existing=await optional(manifestPath);let record=existing?JSON.parse(existing):{createdAt:new Date().toISOString(),targetRoot,version:targetManifest.version,files:{},protectedFiles};
if(!existing){
  for(const file of files){
    const path=join(targetRoot,file), data=await optional(path);
    if(data){if((await lstat(path)).isSymbolicLink())throw new Error('Refuse symlink target: '+path);await mkdir(dirname(join(backup,file)),{recursive:true});await writeFile(join(backup,file),data);}
    record.files[file]=data?hash(data):null;
  }
  await writeFile(manifestPath,JSON.stringify(record,null,2)+'\n');
}
const updated=[];
for(const file of files){
  const destination=resolve(targetRoot,file);
  if(!destination.startsWith(targetRoot+'/')||!files.includes(file))throw new Error('Unexpected destination');
  const source=await readFile(join(sourceRoot,file)),current=await optional(destination);
  if(current&&hash(current)===hash(source))continue;
  const currentHash=current?hash(current):null;
  if(currentHash!==record.files[file]&&targetManifest.version!==sourceManifest.version)throw new Error('Installed file changed since backup: '+file);
  if(current&&(await lstat(destination)).isSymbolicLink())throw new Error('Refuse symlink target');
  const temporary=destination+'.dfm-'+randomUUID()+'.tmp';
  if(dirname(temporary)!==dirname(destination))throw new Error('Invalid temporary destination');
  await mkdir(dirname(destination),{recursive:true});
  await writeFile(temporary,source,{flag:'wx'});
  // Both absolute rename paths are checked above and remain inside this exact installation.
  await rename(temporary,destination);
  updated.push({file,sha256:hash(source)});
}
for(const [file,expected] of Object.entries(protectedFiles))if(hash(await readFile(join(targetRoot,file)))!==expected)throw new Error('Protected file changed: '+file);
const result={completedAt:new Date().toISOString(),sourceRoot,targetRoot,version:sourceManifest.version,backup,updated,protectedFiles};
await writeFile(join(sourceRoot,'.release-backups','deployment.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
