import { OTEA_VERSION } from './version.ts';

// The entry of the otea command. The version is answered here, before the commands load: they are
// hundreds of modules, which a call that only asks for the version has no use for. Everything else
// runs in program.ts.
const [only, ...rest] = process.argv.slice(2);

if ((only === '--version' || only === '-v') && rest.length === 0) {
  process.stdout.write(`${OTEA_VERSION}\n`);
} else {
  await import('./program.ts');
}
