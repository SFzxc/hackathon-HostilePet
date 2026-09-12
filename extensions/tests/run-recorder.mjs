import {execFileSync} from 'node:child_process';
for(const file of ['recorder-browser.mjs','recorder-social.mjs','recorder-history.mjs','recorder-schedule.mjs'])execFileSync(process.execPath,['tests/'+file],{stdio:'inherit'});
