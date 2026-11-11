import { describe, expect, it } from 'vitest';
import { inferTermCategory } from '../shared/term-category';
import { importTable, recommendTableImport } from '../shared/table-import';
import { compileHotwords } from '../shared/compiler';
import type { ParsedSegment } from '../shared/schema';

const table = (rows: string[][], label = '通用'): ParsedSegment => ({ id: 'mixed', label, rows, text: rows.map(row => row.join('\t')).join('\n') });

describe('通用双语表的人名分类', () => {
  it('连续外籍名单不依赖邻近机构，支持中间名与括号别名', () => {
    const rows = [['中文', '英文'], ['艾玛·斯通', 'Emma Stone'], ['索菲亚·马丁', 'Sophia Martin'], ['奥利弗·威尔逊', 'Oliver J. Wilson'], ['徐思远', 'Siyuan (Alex) Xu'], ['杨雨宁', 'Yang Yuning']];
    expect(importTable([table(rows)], 0, 1, true, true).candidates.map(c => c.category)).toEqual(Array(5).fill('person'));
  });
  it('包含人名的机构、奖项和连字符化学名称不能当作人名', () => {
    for (const [source, target, expected] of [
      ['艾玛·斯通癌症中心', 'Emma Stone Cancer Centre', 'company'],
      ['思远制药', 'SY (Smith & Co.)', 'company'],
      ['Alex Smith 新星奖', 'Alex Smith Rising Star Award', 'other'],
      ['丙烯腈-丁二烯-苯乙烯', 'Acrylonitrile Butadiene Styrene', 'industry'],
      ['研究者发起的临床试验', 'Investigator-Initiated Trial (IIT)', 'industry'],
      ['抗体偶联药物', 'ADC', 'industry'],
    ]) expect(inferTermCategory({ source, target })).toBe(expected);
  });
  it('继承合并分类标题，忽略说明中列举的分类，不把类别标题当热词', () => {
    const result = importTable([table([['中文','英文'], ['人名',''], ['任雨宁','Yuning Ren'], ['索菲亚·马丁','Sophia Martin'], ['地名',''], ['石桥','Stonebridge'], ['机构',''], ['青山医院','Greenhill Hospital'], ['行业术语',''], ['王水','Aqua Regia']])],0,1,true,true);
    expect(result.candidates.map(c=>c.category)).toEqual(['person','person','place','company','industry']);
    expect(result.candidates).toHaveLength(5);
    expect(inferTermCategory({source:'抗体偶联药物',target:'ADC',context:['人名、地名、行业术语']})).toBe('industry');
  });
  it('每张表保留原有翻译方向，不把英译中表倒置产生伪冲突', () => {
    const result = importTable([table([['中文','英文'],['徐思远','Siyuan Xu']], '中译英'), {...table([['英文','中文'],['Siyuan Xu','徐思远']], '英译中'),id:'reverse'}],0,1,true,true);
    expect(result.candidates.map(c=>[c.source,c.target])).toEqual([['徐思远','Siyuan Xu'],['Siyuan Xu','徐思远']]);
  });
  it('人名、机构和职务混排时保留完整人名并分类，而不是把整张表归为人名', () => {
    const segment = table([
      ['中文', '英文', '备注'],
      ['王晓峰', 'Alex Wang'],
      ['青山大学', 'Greenhill University'],
      ['首席顾问', 'Chief Advisor'],
      ['魏明安', 'Scott Morgan'],
      ['高级研究员', 'Senior Fellow'],
      ['Alex Taylor', ''],
      ['青山研究院', 'Greenhill Institute'],
      ['艾玛・斯通', 'Emma Stone'],
      ['人道主义者', 'Humanitarian'],
      ['叶黄思明女士', 'Mrs. Ann Ip'],
      ['叶黄思明', 'Ann Ip'],
      ['王水', 'Aqua Regia'],
      ['张力控制', 'Tension Control'],
    ]);
    const recommendation = recommendTableImport([segment]);
    const result = importTable([segment], 0, 1, recommendation.skipHeader, true);
    const people = result.candidates.filter(c => c.category === 'person');
    expect(people.map(c => c.source)).toEqual(['王晓峰', '魏明安', 'Alex Taylor', '艾玛・斯通', '叶黄思明女士', '叶黄思明']);
    expect(people.find(c => c.source === 'Alex Taylor')).toMatchObject({ target: '', translation: false });
    expect(result.candidates.find(c => c.source === '青山大学')?.category).toBe('company');
    expect(result.candidates.find(c => c.source === '首席顾问')?.category).toBe('other');
    expect(result.candidates.find(c => c.source === '王水')?.category).toBe('industry');
    expect(result.candidates.find(c => c.source === '张力控制')?.category).toBe('industry');
  });

  it('支持姓名表头、不同列位置与中文罕见字，不要求工作表叫人名', () => {
    const segment = table([['序号', '中文姓名', 'English Name'], ['1', '王𠀀霖', 'Alex Wang'], ['2', '任和', 'River Ren']], '通用对照');
    const recommendation = recommendTableImport([segment]);
    expect(recommendation).toMatchObject({ automatic: true, sourceColumn: 1, targetColumn: 2, skipHeader: true });
    expect(importTable([segment], 0, 1, true, true).candidates.map(c => c.category)).toEqual(['person', 'person']);
    expect(inferTermCategory({ source: '王𠀀霖', target: 'Alex Wang' })).toBe('person');
  });

  it('支持常见粤语姓氏拼写、罗马字顺序与姓氏首字母缩写', () => {
    for (const [source, target] of [['周思远', 'Aaron Chow Yat-ming'], ['梁思远', 'Leon Leung'], ['陈思远', 'Anna CY Chan'], ['王晓峰', 'Xiaofeng Wang']]) {
      expect(inferTermCategory({ source, target })).toBe('person');
    }
  });

  it('英文大写短语和看起来像姓名的中文术语不能仅因邻近嘉宾职务变成人名', () => {
    const neighbors = [{ source: '首席顾问', target: 'Chief Advisor' }];
    for (const [source, target] of [['直接纱', 'Direct Roving'], ['白墨盒', 'White Ink Box'], ['王水', 'Aqua Regia'], ['张力控制', 'Tension Control'], ['高强纱', 'High Strength Yarn'], ['高端封装', 'Advanced Packaging']]) {
      expect(inferTermCategory({ source, target, neighbors }), source).toBe('industry');
    }
    expect(inferTermCategory({ source: 'Greenhill Foundation', target: '', neighbors })).toBe('company');
    expect(inferTermCategory({ source: '青山大学校务委员会副主任', target: 'Vice Chancellor of Greenhill University Council', neighbors })).toBe('other');
  });

  it('缺少译名的英文人名有职务或机构依据时只作人名热词，不编造译名', () => {
    expect(inferTermCategory({ source: 'Alex Morgan', target: '', neighbors: [{ source: '青山大学', target: 'Greenhill University' }] })).toBe('person');
    expect(inferTermCategory({ source: 'Alex Morgan', target: '' })).toBe('industry');
    expect(inferTermCategory({ source: 'Alex Morgan', target: '', context: ['嘉宾名单'] })).toBe('person');
  });

  it('人名分类在字符预算中生效，完整人名优先于同表的行业词条', () => {
    const segment = table([['中文', '英文'], ['普通术语'.repeat(35), ''], ['王晓峰', 'Alex Wang']]);
    const candidates = importTable([segment], 0, 1, true, true).candidates;
    const filler = candidates[0];
    const hot = compileHotwords([...Array.from({ length: 30 }, (_, i) => ({ ...filler, id: `filler-${i}`, source: filler.source + i, priority: 100 })), candidates[1]]);
    expect(hot.content.split('，')).toEqual(expect.arrayContaining(['王晓峰', 'Alex Wang']));
    expect(hot.excluded.length).toBeGreaterThan(0);
  });
});
