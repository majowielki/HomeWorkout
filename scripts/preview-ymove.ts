/** Builds portable, offline review galleries from the curated local assets. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import catalogue from '../data/exercises.json';

const ROOT = join(__dirname, '..', 'assets', 'ymove-trial');
type RecordInfo = {
  title: string;
  videoFile: string;
  bodyMapFile: string;
  reason?: string;
  instructions?: string[];
  importantPoints?: string[];
};
type Polish = { instructions: string[]; importantPoints: string[] };
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function gallery(title: string, records: RecordInfo[]): string {
  const cards = records
    .map(
      (m) => `<article>
    <h2>${escape(m.title)}</h2>
    ${m.reason ? `<p class="reason">${escape(m.reason)}</p>` : ''}
    <div class="media"><video controls loop muted playsinline preload="none" src="${escape(m.videoFile)}"></video>
    <img loading="lazy" src="${escape(m.bodyMapFile)}" alt="Mapa mięśni: ${escape(m.title)}"></div>
    <details><summary>Instrukcje i wskazówki</summary>
    <ol>${(m.instructions ?? []).map((s) => `<li>${escape(s)}</li>`).join('')}</ol>
    <ul>${(m.importantPoints ?? []).map((s) => `<li>${escape(s)}</li>`).join('')}</ul></details>
    </article>`,
    )
    .join('\n');
  return `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#10191d;color:#edf5f1;font:16px/1.6 system-ui,sans-serif}
  header{padding:24px;max-width:1500px;margin:auto}h1{margin:0;color:#b8ed95}h2{font-size:18px;margin:0 0 14px}
  input{width:100%;padding:14px;border:1px solid #607772;border-radius:12px;background:#1b2a2f;color:white;font:inherit}
  main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;padding:0 24px 36px;max-width:1500px;margin:auto}
  article{background:#1b2a2f;border:1px solid #34504b;border-radius:18px;padding:20px}article[hidden]{display:none}
  .media{display:flex;gap:12px;align-items:flex-start}video{width:55%;max-height:380px;background:white;border-radius:10px}
  img{width:42%;background:white;border-radius:10px}summary{cursor:pointer;margin-top:16px}.reason{color:#ffd291}li{margin-bottom:8px}
  </style><header><h1>${escape(title)}</h1><p>${records.length} zestawów film + mapa mięśni. Odtwarzanie uruchamiasz przyciskiem na filmie.</p>
  <input type="search" placeholder="Szukaj ćwiczenia lub powodu odłożenia…" aria-label="Szukaj ćwiczenia"></header><main>${cards}</main>
  <script>const normalize=s=>s.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  document.querySelector('input').addEventListener('input',e=>{const q=normalize(e.target.value);for(const a of document.querySelectorAll('article'))a.hidden=!normalize(a.textContent).includes(q)});</script></html>`;
}

const mapping = readJson<Record<string, RecordInfo>>(join(ROOT, 'ready', 'mapping.json'));
const polish = readJson<Record<string, Polish>>(join(ROOT, 'ready', 'translations.json'));
const names = new Map(catalogue.exercises.map((e) => [e.id, e.name]));
const ready = Object.entries(mapping).map(([id, m]) => ({
  ...m,
  title: names.get(id) ?? id,
  ...polish[id],
}));
ready.sort((a, b) => a.title.localeCompare(b.title, 'pl'));
const archive = readJson<RecordInfo[]>(join(ROOT, 'archive', 'exercises.json'));
writeFileSync(
  join(ROOT, 'ready', 'index.html'),
  gallery('Ćwiczenia podłączone do HomeWorkout', ready),
);
writeFileSync(join(ROOT, 'archive', 'index.html'), gallery('Archiwum materiałów YMove', archive));
console.log(
  `Galleries: ready/index.html (${ready.length}), archive/index.html (${archive.length})`,
);
