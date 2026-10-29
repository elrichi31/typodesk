/**
 * Genera js/words.js a partir de dos fuentes públicas:
 *
 *  - hermitdave/FrequencyWords  -> lista de frecuencia del español (subtítulos)
 *  - olea/lemarios              -> lemario general del español
 *
 * - `common`: ~3.000 palabras frecuentes y "normales" para los tests.
 * - `extra`:  el lemario completo (2-10 letras) para que los filtros por
 *             letras tengan suficiente variedad.
 *
 * Uso:  node tools/build-words.mjs
 */

const FREQ_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt";
const ENG_URL =
  "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt";
const LEM_URL =
  "https://raw.githubusercontent.com/olea/lemarios/master/lemario-general-del-espanol.txt";

const COMMON_LIMIT = 3000;

// Ruido típico de subtítulos, interjecciones en inglés y nombres propios.
const STOP = new Set(
  `huh mmm hmm uh ugh eh ah oh ok okay yeah yep nope wow hey hi hello bye please thanks sorry
   guys dude bro honey baby darling sir madam mister mr mrs ms dr daddy mommy mom dad momma papa
   mama gonna wanna gotta aint yall maam shh shush ahem hooray yo whoa ooh oops bleh meh nah yay
   woo haha jaja jeje lol marty molly willie quinn carrie zoe elliot shane jin heather nicole
   ronnie mitchell ali sarah john jack mike michael david james tom max sam anna mary chris peter
   paul mark frank george harry tim jim joe ben dan ray roy leo bill bob ted amy emma julia kate
   lucy nancy karen linda susan betty dorothy alice rose grace joy faith hope charity lucky
   stuart stewart ross rachel monica chandler joey phoebe simpson homer marge bart lisa maggie
   walter jesse hank saul gustavo jesse juan pedro luis carlos miguel jorge antonio manuel
   francisco javier diego alejandro fernando sergio andres alberto ricardo roberto eduardo
   ramon raul jesus daniel diana laura marta lucia elena carmen rosa pilar ana sofia valeria
   gabriela daniela paula andrea natalia camila mariana isabela ximena renata`
    .split(/\s+/)
    .filter(Boolean)
);

const ACCENTS = {
  á: "a", à: "a", ä: "a", â: "a", ã: "a",
  é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i",
  ó: "o", ò: "o", ö: "o", ô: "o", õ: "o",
  ú: "u", ù: "u", ü: "u", û: "u",
};

const foldWord = (w) => [...w].map((c) => ACCENTS[c] ?? c).join("");
const VALID = /^[a-zñáéíóúü]{2,12}$/;

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
};

console.log("descargando listas…");
const [freqRaw, engRaw, lemRaw] = await Promise.all([
  get(FREQ_URL),
  get(ENG_URL),
  get(LEM_URL),
]);

const english = new Set(
  engRaw.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean)
);

const freq = freqRaw
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [word, count] = line.split(" ");
    return { word: word.toLowerCase(), count: Number(count) };
  })
  .filter((x) => VALID.test(x.word));

const lemario = [
  ...new Set(
    lemRaw
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => /^[a-zñáéíóúü]{2,10}$/.test(w))
  ),
];

const lemSet = new Set(lemario);

// ---- palabras comunes -------------------------------------------------
const seen = new Set();
const common = [];
for (const { word } of freq) {
  if (common.length >= COMMON_LIMIT) break;
  if (STOP.has(word)) continue;
  // Si no es una palabra del lemario y sí existe en inglés, casi seguro es ruido.
  if (!lemSet.has(word) && english.has(word)) continue;

  const key = foldWord(word);
  if (seen.has(key)) continue;
  seen.add(key);
  common.push(word);
}

// ---- diccionario amplio -----------------------------------------------
const extra = [];
const extraSeen = new Set(seen);
for (const word of lemario) {
  if (STOP.has(word)) continue;
  const key = foldWord(word);
  if (extraSeen.has(key)) continue;
  extraSeen.add(key);
  extra.push(word);
}

const out = `/* Generado automáticamente por tools/build-words.mjs — no editar a mano.
   Fuentes: hermitdave/FrequencyWords (es) y olea/lemarios. */
window.TYPO_WORDS = {
  common: ${JSON.stringify(common.join(" "))}.split(" "),
  extra: ${JSON.stringify(extra.join(" "))}.split(" "),
};
`;

const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync("js", { recursive: true });
writeFileSync("js/words.js", out, "utf8");

console.log(`common: ${common.length} palabras`);
console.log(`extra:  ${extra.length} palabras`);
console.log(`archivo: ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
console.log("primeras comunes:", common.slice(0, 30).join(" "));
