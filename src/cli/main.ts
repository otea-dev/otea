import './started-by.ts';
import { OTEA_VERSION } from './version.ts';

// The entry of the otea command. The version is answered here, before the commands load: they are
// hundreds of modules, which a call that only asks for the version has no use for. Everything else
// runs in program.ts. This path skips the once-a-day notice of a newer @otea/cli on purpose: the
// notice only follows a command (update-notice.ts needs its name), which --version never was.
const [only, ...rest] = process.argv.slice(2);

if ((only === '--version' || only === '-v') && rest.length === 0) {
  process.stdout.write(`${OTEA_VERSION}\n`);
} else {
  await import('./program.ts');
}
