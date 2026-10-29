// The language of the translator's log, messages and the files it writes notes into: the mod
// manager's (Korean, else English: the same rule as the translator window, translator-i18n.js).
// service.js tells it where the manager's language comes from. say('한국어', 'English').
let current = () => 'ko';

const LANG_EN = { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese', ru: 'Russian', de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', pl: 'Polish', tr: 'Turkish' };
const LANG_KO = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', ru: '러시아어', de: '독일어', fr: '프랑스어', es: '스페인어', pt: '포르투갈어', pl: '폴란드어', tr: '튀르키예어' };

const isKo = () => String(current() || '') === 'ko';
const say = (ko, en) => (isKo() ? ko : en);
// A language's name (ko / en / ja …) in that language.
const langName = (code) => (isKo() ? LANG_KO[code] : LANG_EN[code]) || code;

module.exports = { setSource: (fn) => { current = fn; }, say, langName, isKo, LANG_EN };
