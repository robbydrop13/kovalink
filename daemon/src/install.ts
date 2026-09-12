import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from './paths.js';

const LABEL = 'io.claap.kovalinkd';

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function entrypoint(): string {
  // `dist/src/main.js`, resolu depuis ce module.
  return resolve(dirname(fileURLToPath(import.meta.url)), 'main.js');
}

function renderPlist(nodePath: string, script: string, home: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${script}</string>
    <string>run</string>
  </array>

  <key>WorkingDirectory</key><string>${home}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>KOVALINK_HOME</key><string>${home}</string>
    <key>KOVALINK_QUIET</key><string>1</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>RunAtLoad</key><true/>

  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/><key>Crashed</key><true/></dict>
  <key>ThrottleInterval</key><integer>10</integer>

  <!-- Session graphique : le trousseau doit etre deverrouille, et le daemon n'a aucun
       sens avant l'ouverture de session de Robin. -->
  <key>LimitLoadToSessionType</key><string>Aqua</string>

  <!-- Interactive : pas de bridage QoS. -->
  <key>ProcessType</key><string>Interactive</string>

  <key>StandardOutPath</key><string>${home}/logs/stdout.log</string>
  <key>StandardErrorPath</key><string>${home}/logs/stderr.log</string>

  <key>SoftResourceLimits</key>
  <dict><key>NumberOfFiles</key><integer>4096</integer></dict>
</dict>
</plist>
`;
}

/** Le chemin reel de node est resolu, jamais suppose a `/usr/local/bin/node`. */
export function installLaunchAgent(): void {
  const home = paths.home();
  mkdirSync(join(home, 'logs'), { recursive: true, mode: 0o700 });
  const file = plistPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderPlist(process.execPath, entrypoint(), home), { mode: 0o644 });

  const uid = String(process.getuid?.() ?? 0);
  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    /* pas encore charge */
  }
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, file], { stdio: 'inherit' });
  process.stdout.write(`LaunchAgent installe : ${file}\n`);
}

export function uninstallLaunchAgent(): void {
  const uid = String(process.getuid?.() ?? 0);
  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    /* deja decharge */
  }
  try {
    unlinkSync(plistPath());
  } catch {
    /* deja absent */
  }
  process.stdout.write('LaunchAgent desinstalle.\n');
}
