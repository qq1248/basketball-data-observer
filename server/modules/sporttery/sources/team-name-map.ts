export const NBA_TEAM_NAME_MAP: Record<string, string[]> = {
  'Atlanta Hawks': ['亚特兰大老鹰', '老鹰', '鹰队'],
  'Boston Celtics': ['波士顿凯尔特人', '凯尔特人', '绿军'],
  'Brooklyn Nets': ['布鲁克林篮网', '篮网', '网队'],
  'Charlotte Hornets': ['夏洛特黄蜂', '黄蜂'],
  'Chicago Bulls': ['芝加哥公牛', '公牛'],
  'Cleveland Cavaliers': ['克利夫兰骑士', '骑士'],
  'Dallas Mavericks': ['达拉斯独行侠', '独行侠', '小牛'],
  'Denver Nuggets': ['丹佛掘金', '掘金'],
  'Detroit Pistons': ['底特律活塞', '活塞'],
  'Golden State Warriors': ['金州勇士', '勇士'],
  'Houston Rockets': ['休斯顿火箭', '休斯敦火箭', '火箭'],
  'Indiana Pacers': ['印第安纳步行者', '步行者'],
  'Los Angeles Clippers': ['洛杉矶快船', '快船'],
  'Los Angeles Lakers': ['洛杉矶湖人', '湖人'],
  'Memphis Grizzlies': ['孟菲斯灰熊', '灰熊'],
  'Miami Heat': ['迈阿密热火', '热火'],
  'Milwaukee Bucks': ['密尔沃基雄鹿', '雄鹿'],
  'Minnesota Timberwolves': ['明尼苏达森林狼', '森林狼', '木狼'],
  'New Orleans Pelicans': ['新奥尔良鹈鹕', '鹈鹕'],
  'New York Knicks': ['纽约尼克斯', '尼克斯'],
  'Oklahoma City Thunder': ['俄克拉荷马城雷霆', '俄克拉荷马雷霆', '雷霆'],
  'Orlando Magic': ['奥兰多魔术', '魔术'],
  'Philadelphia 76ers': ['费城76人', '76人', '七六人'],
  'Phoenix Suns': ['菲尼克斯太阳', '凤凰城太阳', '太阳'],
  'Portland Trail Blazers': ['波特兰开拓者', '开拓者'],
  'Sacramento Kings': ['萨克拉门托国王', '国王'],
  'San Antonio Spurs': ['圣安东尼奥马刺', '马刺'],
  'Toronto Raptors': ['多伦多猛龙', '猛龙'],
  'Utah Jazz': ['犹他爵士', '爵士'],
  'Washington Wizards': ['华盛顿奇才', '奇才'],
};

export const WNBA_TEAM_NAME_MAP: Record<string, string[]> = {
  'Atlanta Dream': ['亚特兰大梦想', '梦想'],
  'Chicago Sky': ['芝加哥天空', '天空'],
  'Connecticut Sun': ['康涅狄格太阳', '康涅狄克太阳', '太阳'],
  'Dallas Wings': ['达拉斯飞翼', '达拉斯飞马', '飞翼', '飞马'],
  'Indiana Fever': ['印第安纳狂热', '狂热'],
  'Las Vegas Aces': ['拉斯维加斯王牌', '王牌', '拉斯维加斯王牌'],
  'Los Angeles Sparks': ['洛杉矶火花', '火花'],
  'Minnesota Lynx': ['明尼苏达山猫', '明尼苏达天猫', '山猫', '天猫'],
  'New York Liberty': ['纽约自由人', '自由人', '自由'],
  'Phoenix Mercury': ['菲尼克斯水星', '凤凰城水星', '水星'],
  'Seattle Storm': ['西雅图风暴', '西雅图暴风', '风暴', '暴风'],
  'Washington Mystics': ['华盛顿神秘人', '华盛顿奇异', '神秘人', '奇异'],
  'Golden State Valkyries': ['金州女武神', '金州女武神队', '女武神'],
  'Toronto Virtus': ['多伦多维图斯', '多伦多美德斯', '维图斯'],
  'Bay Area Valkyries': ['金州女武神', '湾区女武神', '女武神'],
};

function buildReverseMap(map: Record<string, string[]>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [englishName, chineseNames] of Object.entries(map)) {
    const lower = englishName.trim().toLowerCase();
    result.set(lower, englishName);
    for (const cn of chineseNames) {
      result.set(cn.trim().toLowerCase(), englishName);
    }
  }
  return result;
}

let nbaReverseMap: Map<string, string> | null = null;
let wnbaReverseMap: Map<string, string> | null = null;

function getNbaReverse(): Map<string, string> {
  if (!nbaReverseMap) nbaReverseMap = buildReverseMap(NBA_TEAM_NAME_MAP);
  return nbaReverseMap;
}

function getWnbaReverse(): Map<string, string> {
  if (!wnbaReverseMap) wnbaReverseMap = buildReverseMap(WNBA_TEAM_NAME_MAP);
  return wnbaReverseMap;
}

export function findEnglishTeamName(chineseOrEnglish: string): string | null {
  const normalized = chineseOrEnglish.trim().toLowerCase();
  const nbaRev = getNbaReverse();
  const wnbaRev = getWnbaReverse();
  if (nbaRev.has(normalized)) return nbaRev.get(normalized) ?? null;
  if (wnbaRev.has(normalized)) return wnbaRev.get(normalized) ?? null;
  for (const [key, english] of nbaRev.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) return english;
  }
  for (const [key, english] of wnbaRev.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) return english;
  }
  return null;
}

export function resolveTeamNames(englishName: string): string[] {
  const trimmed = englishName.trim();
  const lower = trimmed.toLowerCase();
  const nbaEntry = NBA_TEAM_NAME_MAP[trimmed];
  const wnbaEntry = WNBA_TEAM_NAME_MAP[trimmed];
  const names: string[] = [trimmed];
  if (nbaEntry) names.push(...nbaEntry);
  if (wnbaEntry) names.push(...wnbaEntry);
  if (lower.endsWith('wings')) {
    const alt = WNBA_TEAM_NAME_MAP['Dallas Wings'] ?? [];
    names.push(...alt.filter((n: string) => !names.includes(n)));
  }
  return names;
}

export function teamNameMatches(injuryTeamName: string, matchTeamName: string): boolean {
  const injuryNormalized = injuryTeamName.trim().toLowerCase();
  const matchNormalized = matchTeamName.trim().toLowerCase();
  if (injuryNormalized === matchNormalized) return true;
  if (injuryNormalized.length < 2 || matchNormalized.length < 2) return false;
  const variants = resolveTeamNames(injuryTeamName).map((n: string) => n.toLowerCase());
  if (variants.includes(matchNormalized)) return true;
  for (const v of variants) {
    if (v.includes(matchNormalized) || matchNormalized.includes(v)) {
      if (matchNormalized.length >= 3 && v.length >= 3) return true;
    }
  }
  const matchEnglish = findEnglishTeamName(matchTeamName);
  if (matchEnglish) {
    const englishLower = matchEnglish.toLowerCase();
    if (englishLower === injuryNormalized) return true;
    if (englishLower.includes(injuryNormalized) || injuryNormalized.includes(englishLower)) {
      if (englishLower.length >= 3 && injuryNormalized.length >= 3) return true;
    }
  }
  return false;
}
