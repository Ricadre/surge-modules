const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src/cf-autorank');
const read = name => fs.readFileSync(path.join(src, name), 'utf8');
const pools = JSON.parse(read('pools.json'));
const version = /^#!version=(.+)$/m.exec(read('module.sgmodule'))[1];
const bundle = '// CF AutoRank v' + version + '. Credentials are entered by the user; never bundle secrets.\n'
  + read('core.js') + '\n' + read('panel.js') + '\nconst CF_RANK_POOLS=' + JSON.stringify(pools) + ';\n' + read('surge.js');
const artifacts = {
  'scripts/CF-AutoRank.js': bundle,
  'modules/CF-AutoRank.sgmodule': read('module.sgmodule'),
};
for (const [name, text] of Object.entries(artifacts)) {
  const target = path.join(root, name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) {
      throw new Error(name + ' differs; run node scripts/build_cf_autorank.cjs');
    }
  } else {
    fs.writeFileSync(target, text);
  }
}
console.log(process.argv.includes('--check') ? 'CF AutoRank artifacts match sources.' : 'Built CF AutoRank remote module and script.');
