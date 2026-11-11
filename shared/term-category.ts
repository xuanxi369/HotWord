import type { Category } from './schema';

type TermPair = { source: string; target: string };
type CategoryInput = TermPair & { context?: string[]; neighbors?: TermPair[] };
const clean = (value: string) => value.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
const personLabel = /人名|姓名|嘉宾名单|人员名单|\b(?:persons?|people|names?|speakers?|guests?|chinese name|english name)\b/i;
const organization = /公司|集团|联盟|大学|学院|研究院|研究所|委员会|协会|基金会|银行|\b(?:corporation|company|university|alliance|association|foundation|institute|college|academy|bank|holdings|inc|ltd|limited)\b/i;
const role = /(?:顾问|研究员|教授|总裁|总监|秘书|局长|主任|主席|委员|创始人|协调员|引导师|学者|人道主义者|建筑师|规划师|工程师|讲师|执行官|医务官|发展官)$/u;
const roleEnglish = /\b(?:chairman|chairwoman|president|professor|advisor|adviser|fellow|founder|coordinator|facilitator|scholar|humanitarian|architect|director|secretary|officer|expert|engineer|lecturer)\b/i;
const surnameForms: Record<string, string[]> = {
  王: ['wang', 'wong'], 李: ['li', 'lee'], 张: ['zhang', 'chang', 'cheung'], 刘: ['liu', 'lau'], 陈: ['chen', 'chan', 'tan'],
  杨: ['yang', 'yeung'], 黄: ['huang', 'wong'], 赵: ['zhao', 'chao', 'chiu'], 吴: ['wu', 'ng'], 周: ['zhou', 'chou', 'chow'],
  徐: ['xu', 'hsu', 'tsui'], 孙: ['sun', 'suen'], 马: ['ma'], 朱: ['zhu', 'chu'], 胡: ['hu', 'woo', 'wu'], 郭: ['guo', 'kwok'],
  何: ['he', 'ho'], 林: ['lin', 'lam', 'lim'], 高: ['gao', 'ko'], 罗: ['luo', 'lo', 'law'], 郑: ['zheng', 'cheng'],
  梁: ['liang', 'leung'], 谢: ['xie', 'tse'], 宋: ['song', 'sung'], 唐: ['tang'], 许: ['xu', 'hui'], 韩: ['han', 'hon'],
  冯: ['feng', 'fung'], 邓: ['deng', 'tang'], 曹: ['cao', 'cho'], 彭: ['peng', 'pang'], 曾: ['zeng', 'tsang'], 萧: ['xiao', 'siu'],
  肖: ['xiao', 'siu'], 田: ['tian'], 董: ['dong', 'tung'], 潘: ['pan', 'poon'], 袁: ['yuan', 'yuen'], 蔡: ['cai', 'tsai', 'choi'],
  蒋: ['jiang', 'chiang'], 余: ['yu'], 于: ['yu'], 杜: ['du', 'tu'], 叶: ['ye', 'yip', 'ip'], 陆: ['lu', 'luk'],
  魏: ['wei'], 苏: ['su', 'so'], 贾: ['jia'], 丁: ['ding', 'ting'], 姚: ['yao', 'yiu'], 沈: ['shen', 'shum'],
  姜: ['jiang', 'keung'], 谭: ['tan', 'tam'], 卢: ['lu', 'lo'], 白: ['bai', 'pak'], 童: ['tong', 'tung'],
  欧阳: ['ouyang', 'auyeung'], 司马: ['sima'], 上官: ['shangguan'], 诸葛: ['zhuge'], 夏侯: ['xiahou'],
};
const commonSurnames = new Set([...Object.keys(surnameForms), ...'钱冯褚卫蒋沈韩朱秦尤许吕施张孔曹严华金陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤滕殷毕郝安常乐时傅皮卞齐康伍顾孟平包石崔吉龚程嵇邢裴陆荣翁荀羊惠甄曲封储靳段富巫乌焦巴弓牧谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾甘厉戎祖武符景詹束龙叶幸司黎薄印宿怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟姬申扶堵冉宰郦雍桑寿通边燕浦尚农温庄晏柴瞿阎连习艾鱼容向古易慎廖庾终暨衡步耿满弘匡国文寇广禄阙东沃利越夔隆师巩厍聂晁勾敖融冷訾辛阚简饶空曾沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公晋楚闫法汝鄢涂钦岳帅缑亢况归海墨哈谯笪年爱阳佟言佘佴伯赏晓谭舒熊毛尹江钟汪卢邱万夏任'] );
const nameHonorific = /^(?:(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Sir|Dame)\.?\s+)+/i;
const chineseHonorific = /(?:先生|女士|小姐|爵士|教授|博士)$/u;
const nonNameWord = /\b(?:garden|hall|venue|center|centre|workshop|roving|fiber|fiberglass|yarn|dye|tea|materials?|composites?|control|technology|equipment|box|regia|learning|research|development|production|packaging|molding|communications?|systems?|forum|conference|dialogue|conversation|dinner|reception|session|program|programme|tour|group|plenary)\b/i;

function latinName(value: string): string[] | undefined {
  const text = clean(value).replace(nameHonorific, '');
  const words = text.split(' ');
  if (words.length < 2 || words.length > 5 || nonNameWord.test(text) || organization.test(text) || roleEnglish.test(text)) return;
  if (!words.every(word => /^(?:\p{Lu}[\p{L}\p{M}]*\.?)(?:[-'’][\p{L}\p{M}]+)*$/u.test(word) || /^(?:van|von|de|del|da|di|la|le)$/i.test(word))) return;
  return words;
}

function chineseName(value: string): { text: string; surname: string } | undefined {
  const text = clean(value).replace(chineseHonorific, '').trim();
  if (!/^\p{Script=Han}{2,5}$/u.test(text)) return;
  const surname = Object.keys(surnameForms).find(key => text.startsWith(key) && key.length === 2) ?? [...text][0];
  const givenLength = [...text].length - [...surname].length;
  if (!commonSurnames.has(surname) || givenLength < 1 || givenLength > 3) return;
  return { text, surname };
}

/** Classify table terms without inventing names or translations. In mixed
 * glossaries, spelling plus nearby roles/institutions supplies the evidence
 * that a generic sheet name cannot. Title case alone is not person evidence.
 */
export function inferTermCategory({ source, target, context = [], neighbors = [] }: CategoryInput): Category {
  const a = clean(source), b = clean(target), text = `${a} ${b}`;
  if (context.some(value => personLabel.test(value))) return 'person';
  if (context.some(value => /地名|\bplaces?\b/i.test(value)) || /^(重庆|长寿|大渡口|福州|巴西|巴林|卡皮瓦里|Chongqing|Changshou|Dadukou|Fuzhou|Brazil|Bahrain|Capivari)$/i.test(a) || /开发区|\b(?:Province|City|Industrial Development Zone)\b/i.test(text)) return 'place';
  if (context.some(value => /^(?:产品|牌号|型号|products?|models?)$/i.test(value))) return 'product';

  const nearbyRole = neighbors.some(term => role.test(clean(term.source)) || roleEnglish.test(clean(term.target)));
  const nearbyInstitution = neighbors.some(term => organization.test(`${term.source} ${term.target}`));
  const givenContext = nearbyRole || nearbyInstitution;
  const latin = latinName(b) ?? latinName(a);
  const han = chineseName(a) ?? chineseName(b);
  const honorific = nameHonorific.test(a) || nameHonorific.test(b) || chineseHonorific.test(a) || chineseHonorific.test(b);
  if (latin && han) {
    const romanizedSurname = latin.some(word => (surnameForms[han.surname] ?? []).includes(word.toLowerCase().replace(/\.$/, '')));
    if (romanizedSurname || givenContext || honorific) return 'person';
  }
  const transliterated = /^\p{Script=Han}{2,}(?:[·・‧•]\s*|\s*-\s*)\p{Script=Han}[\p{Script=Han}\s·・‧•-]*$/u.test(a.replace(chineseHonorific, '')) || /^\p{Script=Han}{2,}(?:[·・‧•]\s*|\s*-\s*)\p{Script=Han}[\p{Script=Han}\s·・‧•-]*$/u.test(b.replace(chineseHonorific, ''));
  if (latin && (givenContext || honorific) && (transliterated || !/[\p{Script=Han}]/u.test(text))) return 'person';
  if (role.test(a) || role.test(b) || roleEnglish.test(a) || roleEnglish.test(b)) return 'other';
  if (organization.test(text)) return 'company';
  if (/^[A-Z][A-Z0-9+]{1,12}$/.test(a)) return 'product';
  return 'industry';
}
