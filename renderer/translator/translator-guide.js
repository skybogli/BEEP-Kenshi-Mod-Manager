// How to write the user's own field / exclude rules: the short help under each box (HINTS) and
// the full guide (GUIDE.open), shown over the settings dialog in its own layer.
const HINTS = {
  work: {
    fields: `【사용자 지정 번역 영역】 위 기본 항목 말고 더 번역할 것을 한 줄에 하나씩 적습니다. 대소문자 · 띄어쓰기는 상관없고, # 으로 시작하는 줄은 메모입니다.
• 칸:  tooltip   General - description (묶음 이름은 무시)   ITEM:tooltip (그 종류에서만)   name (레코드 이름)
• 범위 전체:  ITEM (Object Type · 대문자)   43392-changes_otto.mod (String ID · 항목 하나)   changes_otto.mod (그 모드가 만든 항목)   → 이름과 글자 칸 전부
• 범위 + 칸:  43392-changes_otto.mod:description   changes_otto.mod:ITEM:name   ITEM:*  (= 그 종류의 이름 뺀 칸 전부)
• '.mod' 로 끝나지 않는 String ID · 모드는 앞에 붙임:  id:123-player_weapons   mod:player_weapons:ITEM
※ 번역은 글자 칸에만 됩니다 (숫자 · 참거짓 · 선택값, files 의 파일 경로는 무시). 범위 전체를 적으면 inventory sound 같은 내부 이름 칸까지 번역되니 조심하세요.
`,
    exclude: `【사용자 지정 번역 제외】 번역하지 않을 것을 한 줄에 하나씩 적습니다. 범위 · 칸을 적는 법은 왼쪽과 같고, 글자로도 제외할 수 있습니다.
• 범위 전체:  ITEM (Object Type · 대문자)   43392-changes_otto.mod (String ID)   changes_otto.mod (출처 모드)
• 칸:  ITEM:description   ITEM:name   43392-changes_otto.mod:name   changes_otto.mod:ITEM:description   field:description   field:General - description
• 원문이 정확히 이것:  text:AI Core        • 원문에 이 글자가 들어 있으면:  contains:ancient technology        • 'AI Core = AI 코어' 줄 → '=' 앞 원문으로
• 앞에 붙이면 그 뜻으로:  id:  mod:  type:  field:  text:  contains:   ⚠ 칸 이름만이나 '묶음 - 칸'은 field: 를 붙여야 함 (안 붙이면 원문 글자로 읽힘)
※ [불러오기…]로 txt 목록을 한꺼번에 넣을 수 있습니다.`,
  },
  patch: {
    fields: `【사용자 지정 복사 영역】 위 기본 항목 말고 패치(_Patch)에 값을 그대로 옮겨 담을 것을 한 줄에 하나씩 적습니다. 숫자 · 참거짓 · 색상 칸도 됩니다.
• 칸:  stackable   inventory - stackable   ITEM:stackable   value   weight kg   FARM_DATA:growth time   name
• 범위 전체:  ITEM (Object Type · 대문자)   43392-changes_otto.mod (String ID · 항목 하나)   changes_otto.mod (그 모드가 만든 항목)   → 이름과 칸 전부
• 범위 + 칸:  43392-changes_otto.mod:value   changes_otto.mod:ITEM:stackable   ITEM:*  (= 그 종류의 이름 뺀 칸 전부)
• '.mod' 로 끝나지 않는 String ID · 모드는 앞에 붙임:  id:123-player_weapons   mod:player_weapons:ITEM
※ files 묶음의 파일 경로와 목록 칸은 복사되지 않습니다. 이 모드에서 찾지 못한 규칙은 작업 로그에 알려 줍니다. 오른쪽 '복사 제외'가 먼저 적용됩니다.`,
    exclude: `【사용자 지정 복사 제외】 패치에 옮기지 않을 것을 한 줄에 하나씩 적습니다. 적는 법은 번역 제외와 같습니다.
• 범위 전체:  CHARACTER   43392-changes_otto.mod   changes_otto.mod        • 범위 + 칸:  43392-changes_otto.mod:value   changes_otto.mod:ITEM:weight kg
• 칸:  ITEM:value   field:inventory - stackable   field:weight kg (칸 이름만 · '묶음 - 칸'은 field: 필요)        • 이 값과 똑같으면:  text:1000        • 이 글자가 들어 있으면:  contains:DIALOG
※ 숫자는 저장된 형태로 비교합니다: 정수 칸 1000 → 1000, 실수 칸 1000 → 1000.0, 2.3 → 2.299999952316284 (실수는 칸 · 항목으로 제외하는 게 확실).`,
  },
};

const HINTS_EN = {
  work: {
    fields: `[Your own fields to translate] One per line: more fields to translate besides the ones ticked above. Case and spaces don't matter; lines starting with # are notes.
• A field:  tooltip   General - description (the group name is ignored)   ITEM:tooltip (that kind only)   name (the record's name)
• A whole range:  ITEM (Object Type · upper case)   43392-changes_otto.mod (String ID · one record)   changes_otto.mod (the records that mod made)   → the name and every text field
• Range + field:  43392-changes_otto.mod:description   changes_otto.mod:ITEM:name   ITEM:*  (= every field of that kind but the name)
• A String ID / mod not ending in '.mod': put id: / mod: in front:  id:123-player_weapons   mod:player_weapons:ITEM
※ Only text fields are translated (numbers, true/false, choices and file paths are skipped). A whole range also translates internal names like inventory sound — take care.`,
    exclude: `[Your own exclusions] One per line: what not to translate. Ranges and fields are written as on the left; text can be left out too.
• A whole range:  ITEM (Object Type · upper case)   43392-changes_otto.mod (String ID)   changes_otto.mod (source mod)
• A field:  ITEM:description   ITEM:name   43392-changes_otto.mod:name   changes_otto.mod:ITEM:description   field:description   field:General - description
• Source text exactly this:  text:AI Core        • Source text containing this:  contains:ancient technology        • An 'AI Core = AI 코어' line → by the text before '='
• A prefix sets the meaning:  id:  mod:  type:  field:  text:  contains:   ⚠ a field name alone or 'Group - field' needs field: (without it, it is read as source text)
※ [Load…] adds a txt list at once.`,
  },
  patch: {
    fields: `[Your own fields to copy] One per line: more fields to copy as they are into the patch (_Patch). Number, true/false and colour fields work too.
• A field:  stackable   inventory - stackable   ITEM:stackable   value   weight kg   FARM_DATA:growth time   name
• A whole range:  ITEM (Object Type · upper case)   43392-changes_otto.mod (String ID · one record)   changes_otto.mod (the records that mod made)   → the name and every field
• Range + field:  43392-changes_otto.mod:value   changes_otto.mod:ITEM:stackable   ITEM:*  (= every field of that kind but the name)
• A String ID / mod not ending in '.mod': put id: / mod: in front:  id:123-player_weapons   mod:player_weapons:ITEM
※ File paths and lists are not copied. Rules that match nothing in the mod are noted in the log. 'Leave out' on the right goes first.`,
    exclude: `[Your own exclusions] One per line: what not to copy. Written as for translation exclusions.
• A whole range:  CHARACTER   43392-changes_otto.mod   changes_otto.mod        • Range + field:  43392-changes_otto.mod:value   changes_otto.mod:ITEM:weight kg
• A field:  ITEM:value   field:inventory - stackable   field:weight kg (a field alone or 'Group - field' needs field:)        • Value exactly this:  text:1000        • Value containing this:  contains:DIALOG
※ Numbers compare as stored: whole-number fields 1000 → 1000, decimal fields 1000 → 1000.0, 2.3 → 2.299999952316284 (decimals: leave out the field or the record instead).`,
  },
};
// The short help under a box, in the window's language.
const hintText = (which, w) => (isEn() ? HINTS_EN : HINTS)[which][w];

const GUIDE = (() => {
  const SECTIONS = [
    ['basics', '처음 읽어 볼 것'],
    ['scope', 'Object Type · String ID · 출처 모드'],
    ['work-fields', '사용자 지정 번역 영역'],
    ['work-exclude', '사용자 지정 번역 제외'],
    ['patch-fields', '사용자 지정 복사 영역'],
    ['patch-exclude', '사용자 지정 복사 제외'],
    ['files', '불러오기 · 저장 · 모두 지우기'],
  ];
  const ex = (rows) => `<table class="gd-table"><tr><th>이렇게 적으면</th><th>뜻</th></tr>${rows.map(([a, b]) => `<tr><td><code>${a}</code></td><td>${b}</td></tr>`).join('')}</table>`;
  const link = (k, t) => `<a class="gd-go" data-go="${k}">${t}</a>`;
  const BODY = {
    basics: `
      <p>FCS(Forgotten Construction Set)에서 항목을 열면 보이는 화면을 기준으로 설명합니다. 예로 <b>AI 코어</b> 항목을 씁니다.</p>
      <pre class="gd-shot">Base       Name = AI 코어 · Object Type = ITEM · String ID = 43392-changes_otto.mod
files      icon · mesh · physics file · ground mesh …
General    description = A rare piece of ancient technology… · slot = ATTACH_NONE
inventory  stackable = 1000 · value = 25000 · weight kg = 1 · inventory sound = Tools …
item       charges · item function · production time · quality …</pre>
      <h4>한 줄에 하나 — 적는 모양</h4>
      ${ex([
        ['description', '<b>칸 이름</b>만 — 모든 항목의 그 칸'],
        ['General - description', 'FCS 화면의 <b>묶음 - 칸</b> 그대로 — 묶음 이름(General)은 무시되고 칸 이름으로 찾음'],
        ['ITEM:description', '<b>Object Type:칸</b> — 그 종류에서만'],
        ['ITEM', '<b>Object Type</b> 만 — 그 종류의 이름과 칸 전부'],
        ['43392-changes_otto.mod', '<b>String ID</b> 만 — 그 항목 하나의 이름과 칸 전부'],
        ['43392-changes_otto.mod:description', '<b>String ID:칸</b> — 그 항목의 그 칸만'],
        ['changes_otto.mod', '<b>출처 모드</b> 만 — 그 모드가 만든 항목 전부'],
        ['changes_otto.mod:ITEM:name', '<b>출처 모드:Object Type:칸</b> — 이렇게 겹쳐 좁힐 수도 있음'],
      ])}
      <p>범위(Object Type · String ID · 출처 모드)는 ${link('scope', 'Object Type · String ID · 출처 모드')} 에서 자세히 설명합니다.</p>
      <ul>
        <li>대소문자, 띄어쓰기, 밑줄( _ )은 상관없습니다. <code>Weight KG</code> = <code>weight kg</code> — 단, 범위로 쓰는 Object Type 을 <b>혼자</b> 쓸 때는 <b>대문자</b>로 씁니다 (<code>ITEM</code>).</li>
        <li><code>#</code> 으로 시작하는 줄은 메모라서 무시됩니다. 줄 앞의 <code>•</code> <code>-</code> 같은 목록 기호도 무시됩니다.</li>
        <li><code>:</code> 앞에는 <b>묶음 이름(General, inventory)이 아니라</b> Object Type · String ID · 출처 모드를 씁니다. Object Type 이름을 틀리면 저장할 때 "혹시 ITEM ?" 처럼 알려 줍니다.</li>
        <li>레코드 이름(Base 의 Name)은 <code>name</code> 또는 <code>Base - name</code> 입니다.</li>
        <li>영역과 제외에 같은 것이 있으면 <b>제외가 먼저</b> 적용됩니다.</li>
        <li><b>제외</b> 칸에서 칸 이름만(<code>description</code>)이나 '묶음 - 칸'(<code>General - description</code>)을 쓸 때는 앞에 <code>field:</code> 를 붙입니다. 안 붙이면 원문 글자(text:)로 읽힙니다. <code>ITEM:description</code> 처럼 Object Type · String ID · 출처 모드로 시작하면 붙이지 않아도 됩니다.</li>
        <li>묶음 이름이 Object Type 이름과 같으면(<code>item - production time</code> 의 item) 그 종류(ITEM)로 좁혀집니다.</li>
      </ul>
      <h4>칸의 종류 — 무엇이 되고 안 되는지</h4>
      <table class="gd-table"><tr><th>종류</th><th>AI 코어의 예</th><th>번역 영역</th><th>복사 영역</th></tr>
        <tr><td>글자</td><td>Name, description, inventory sound</td><td>됨</td><td>됨</td></tr>
        <tr><td>숫자 · 참거짓 · 선택값</td><td>stackable, value, weight kg, artifact, has collision, slot, item function, persistent, icon offset …, quality</td><td>적어도 무시</td><td>됨</td></tr>
        <tr><td>파일 경로 (files 묶음)</td><td>icon, mesh, physics file, ground mesh</td><td>안 됨</td><td>안 됨</td></tr>
        <tr><td>범위 정보</td><td>Object Type, String ID</td><td colspan="2">칸은 아니지만 <b>범위</b>로 씀 — 영역 · 제외 모두 (${link('scope', '자세히')})</td></tr></table>
      <p class="gd-warn">⚠ inventory sound(값 Tools) 같은 글자 칸은 게임이 내부 이름으로 씁니다. 번역하면 소리 · 기능이 동작하지 않을 수 있으니 번역하지 마세요. 범위 전체(<code>ITEM</code>, String ID 만 적기)로 번역 영역에 넣으면 이런 칸도 함께 번역됩니다.</p>`,
    scope: `
      <p>FCS 화면 맨 위 Base 묶음의 <b>Object Type</b> 과 <b>String ID</b> 는 칸(값)은 아니지만, 규칙이 <b>어느 항목에 걸릴지</b>를 정하는 범위로 씁니다. 번역 영역 · 번역 제외 · 복사 영역 · 복사 제외 네 곳 모두 같은 방법입니다.</p>
      <h4>Object Type — 항목의 종류</h4>
      <ul>
        <li>AI 코어의 Object Type 은 <code>ITEM</code> 입니다. 그 밖에 BUILDING, CHARACTER, WEAPON, ARMOUR, FARM_DATA, DIALOGUE_LINE … 이 있습니다.</li>
        <li>혼자 쓸 때는 <b>대문자</b>로: <code>ITEM</code> (소문자 <code>item</code> 만 쓰면 칸 이름 · 원문으로 읽힘). 대소문자를 신경 쓰기 싫으면 <code>type:item</code>.</li>
        <li>칸과 함께: <code>ITEM:description</code>, <code>type:ITEM:description</code> — 이때는 소문자도 됩니다 (<code>item:description</code>).</li>
        <li>종류 번호로도 됩니다: <code>4:description</code> (ITEM = 4).</li>
      </ul>
      <h4>String ID — 항목 하나</h4>
      <ul>
        <li>AI 코어의 String ID 는 <code>43392-changes_otto.mod</code> — <b>번호-그 항목을 처음 만든 모드 파일</b> 입니다.</li>
        <li>찾는 곳: FCS 의 String ID 칸, 작업 로그의 <code># [43392-changes_otto.mod]</code> 줄, 번역 검수 창의 String ID 열 (그대로 복사해서 붙여 넣으면 됨).</li>
        <li>그대로 쓰면 그 항목의 이름과 칸 전부, 뒤에 <code>:칸</code> 을 붙이면 그 칸만: <code>43392-changes_otto.mod:description</code></li>
        <li>String ID 가 <code>.mod</code> · <code>.base</code> 로 끝나지 않으면(예: <code>123-player_weapons</code>) 앞에 <code>id:</code> 를 붙입니다: <code>id:123-player_weapons</code>, <code>id:123-player_weapons:name</code></li>
      </ul>
      <h4>출처 모드 — 그 모드가 만든 항목 전부</h4>
      <ul>
        <li>String ID 의 <code>-</code> 뒤 부분입니다: <code>changes_otto.mod</code> → String ID 가 <code>…-changes_otto.mod</code> 인 항목 전부.</li>
        <li>칸 · Object Type 과 겹쳐서: <code>changes_otto.mod:description</code>, <code>changes_otto.mod:ITEM</code>, <code>changes_otto.mod:ITEM:name</code></li>
        <li><code>.mod</code> 로 끝나지 않으면 <code>mod:</code> 를 붙입니다: <code>mod:player_weapons:ITEM</code></li>
        <li>⚠ 다른 모드의 항목을 고친 모드는 String ID 가 <b>원래 모드</b>를 가리킵니다. 예: 바닐라 아이템을 고친 모드라면 <code>…-rebirth.mod</code> · <code>…-gamedata.base</code>. 그래서 "지금 작업하는 모드 이름" 으로는 그 항목이 안 걸릴 수 있습니다 — 작업 로그의 <code># [ ]</code> 줄로 확인하세요.</li>
        <li>[한글화 추출 설정]의 '번역 제외 적용'(rebirth.mod, gamedata.base, Newwworld.mod, Dialogue.mod)도 이 출처 모드 제외입니다.</li>
      </ul>
      <h4>범위만 적을 때 vs <code>*</code></h4>
      ${ex([
        ['ITEM', 'ITEM 의 <b>이름과</b> 칸 전부'],
        ['ITEM:*', 'ITEM 의 칸 전부 (<b>이름은 빼고</b>)'],
        ['43392-changes_otto.mod', '그 항목의 이름과 칸 전부'],
        ['43392-changes_otto.mod:*', '그 항목의 칸 전부 (이름 빼고)'],
      ])}
      <p>대화(DIALOGUE · DIALOGUE_LINE · DIALOGUE_PACKAGE) 항목의 이름은 편집기 안에서만 쓰는 이름이라 어떤 규칙으로도 번역 · 복사하지 않습니다.</p>
      <p>규칙의 String ID · 출처 모드가 이 모드에 없으면 작업 로그에 "[안내] 규칙의 String ID … 에 해당하는 레코드가 이 모드에 없습니다" 라고 알려 줍니다.</p>`,
    'work-fields': `
      <p>[한글화 추출 설정]의 기본 항목(name, description, category …) 말고 <b>더 번역할 글자 칸</b>을 적습니다. 한글화 패치모드 생성 · 원본 직접 한글화 · 번역 추출에 쓰입니다.</p>
      ${ex([
        ['tooltip', '모든 항목의 tooltip 칸'],
        ['ITEM:tooltip', 'ITEM 의 tooltip 만'],
        ['General - description', 'description 칸 (General 은 무시)'],
        ['ITEM:name', 'ITEM 의 이름 (기본 항목의 name 을 끄고 종류별로만 켤 때)'],
        ['ITEM', 'ITEM 의 이름과 글자 칸 전부 — ⚠ inventory sound 같은 내부 이름 칸도 포함'],
        ['ITEM:*', 'ITEM 의 글자 칸 전부 (이름 빼고)'],
        ['43392-changes_otto.mod', 'AI 코어 한 항목의 이름과 글자 칸 전부'],
        ['43392-changes_otto.mod:description', 'AI 코어의 description 만'],
        ['changes_otto.mod:ITEM:name', 'changes_otto.mod 가 만든 ITEM 의 이름만'],
      ])}
      <ul>
        <li>'ITEM:칸' 인데 ITEM 에는 그 칸이 없고 다른 종류에만 있으면, 작업할 때 종류 제한을 풀고 그 칸 이름으로 찾은 뒤 로그에 알려 줍니다.</li>
        <li>번역 대상이 되려면 [감지 언어]에서 고른 언어의 글자가 들어 있어야 합니다. 숫자만 있는 값, 파일 이름처럼 보이는 값은 번역하지 않습니다.</li>
        <li>범위 쓰는 법: ${link('scope', 'Object Type · String ID · 출처 모드')}</li>
      </ul>`,
    'work-exclude': `
      <p>번역하지 <b>않을</b> 것을 적습니다. 범위 · 칸은 영역과 같은 방법으로 적고, 원문 글자로도 제외할 수 있습니다. 앞에 <code>mod:</code> <code>id:</code> <code>type:</code> <code>field:</code> <code>text:</code> <code>contains:</code> 를 붙이면 그 뜻으로, 안 붙이면 모양을 보고 판단합니다.</p>
      ${ex([
        ['43392-changes_otto.mod', '<b>항목 하나</b> 전체 (String ID — 숫자-로 시작하면 이것으로 봄)'],
        ['43392-changes_otto.mod:name', '그 항목의 이름만 번역 안 함'],
        ['changes_otto.mod', '<b>출처 모드</b>가 만든 항목 전체 (.mod / .base 로 끝나면 이것)'],
        ['changes_otto.mod:ITEM:description', '그 모드가 만든 ITEM 의 description 만'],
        ['ITEM', '<b>Object Type 전체</b> (대문자로) · type:item 처럼 써도 됨'],
        ['ITEM:description', '<b>칸</b> — ITEM 의 description 만'],
        ['field:General - description', '칸 — 모든 항목의 description (field:description 과 같음). ⚠ field: 없이 쓰면 원문 글자로 읽힘'],
        ['ITEM:name', 'ITEM 의 이름만'],
        ['text:AI Core', '원문이 <b>정확히</b> "AI Core" 인 것 (앞뒤 공백 · 대소문자 무시)'],
        ['contains:ancient technology', '원문에 이 글자가 <b>들어 있으면</b> 전부'],
        ['AI Core = AI 코어', '용어집 줄을 그대로 붙여 넣으면 \'=\' 앞 원문으로 text: 처리'],
        ['Hello', '아무 표시 없는 글자 → text:Hello 와 같음 (소문자 item 도 text:item 이 됨)'],
      ])}
      <ul><li>줄바꿈이 있는 원문은 <code>\\n</code> 으로 적습니다: <code>text:첫 줄\\n둘째 줄</code></li>
        <li>범위 쓰는 법: ${link('scope', 'Object Type · String ID · 출처 모드')}</li></ul>`,
    'patch-fields': `
      <p>[항목 복사 패치 만들기](_Patch)에서 기본 항목 말고 <b>더 옮겨 담을 것</b>을 적습니다. 번역은 하지 않고 값을 그대로 복사하며, <b>숫자 · 참거짓 · 색상 칸도 됩니다.</b> 이 패치를 원본 뒤에 두면 그 값만 덮어씁니다.</p>
      ${ex([
        ['stackable', '겹치기 수 (AI 코어: 1000) — 모든 항목'],
        ['inventory - stackable', '같은 뜻 (inventory 는 무시)'],
        ['ITEM:stackable', 'ITEM 의 stackable 만'],
        ['value', '가격 (25000)'],
        ['weight kg', '무게'],
        ['item - production time', '생산 시간 (묶음 이름 item 이 Object Type 과 같아 ITEM 으로 좁혀짐)'],
        ['ITEM:artifact', '참거짓 칸도 복사'],
        ['FARM_DATA:growth time', '농작물 자라는 시간'],
        ['ITEM', 'ITEM 의 이름과 칸 전부'],
        ['ITEM:*', 'ITEM 의 칸 전부 (이름 빼고)'],
        ['43392-changes_otto.mod', 'AI 코어 한 항목의 이름과 칸 전부'],
        ['43392-changes_otto.mod:value', 'AI 코어의 가격만'],
        ['changes_otto.mod:ITEM:stackable', 'changes_otto.mod 가 만든 ITEM 의 stackable 만'],
        ['name', '레코드 이름'],
      ])}
      <ul><li>files 묶음의 파일 경로와 목록(참조) 칸은 복사되지 않습니다.</li>
        <li>이 모드에서 찾지 못한 규칙은 작업 로그에 "[안내] 규칙 'value' 에 맞는 필드가 없습니다. 비슷한 필드 이름: …" 처럼 알려 줍니다.</li>
        <li>범위 쓰는 법: ${link('scope', 'Object Type · String ID · 출처 모드')}</li></ul>`,
    'patch-exclude': `
      <p>패치에 옮기지 <b>않을</b> 것을 적습니다. 적는 법은 번역 제외와 같습니다.</p>
      ${ex([
        ['43392-changes_otto.mod', '항목 하나 전체'],
        ['43392-changes_otto.mod:value', '그 항목의 가격만'],
        ['changes_otto.mod', '출처 모드가 만든 항목 전체'],
        ['CHARACTER', 'Object Type 전체'],
        ['ITEM:value', 'ITEM 의 value 칸만'],
        ['field:inventory - stackable', '모든 항목의 stackable (field: 없이 쓰면 원문 글자로 읽힘)'],
        ['text:1000', '값이 정확히 1000 인 것 (정수 칸 — 실수 칸이면 text:1000.0)'],
        ['contains:DIALOG', '값에 DIALOG 가 들어 있는 것'],
      ])}
      <ul><li>숫자는 저장된 형태로 비교합니다. 정수 칸은 1000 그대로, 실수 칸은 1000.0 처럼 소수점이 붙고, 2.3 같은 값은 2.299999952316284 로 저장되어 text: 로 맞추기 어렵습니다 — 칸(ITEM:icon zoom)이나 항목으로 제외하세요.</li></ul>`,
    files: `
      <ul>
        <li><b>불러오기…</b> — txt 파일의 줄을 칸에 더합니다 (이미 있는 줄은 빼고). UTF-8 · CP949 모두 읽습니다.</li>
        <li><b>저장…</b> — 칸의 내용을 txt 로 저장합니다. 기본 이름: <code>한글화_번역영역_연월일_시분.txt</code>, <code>한글화_번역제외_…</code>, <code>패치복사_복사영역_…</code>, <code>패치복사_복사제외_…</code> (기본 위치: 데이터 폴더)</li>
        <li><b>모두 지우기</b> — 칸을 비웁니다. 바로 Ctrl+Z 로 되돌릴 수 있고, [저장]을 누르기 전까지는 설정에 들어가지 않습니다 ([취소]하면 그대로).</li>
        <li>칸 위의 체크를 끄면 적어 둔 내용은 남기고 작업에만 쓰지 않습니다.</li>
      </ul>`,
  };

  let layer = null;
  function open(start = 'basics') {
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'tr-overlay page gd-layer';
      document.body.appendChild(layer);
    }
    layer.innerHTML = `<div class="tr-dialog gd-dialog">
      <div class="gd-wrap"><nav class="gd-nav">${SECTIONS.map(([k, t]) => `<button class="gd-link" data-k="${k}">${t}</button>`).join('')}</nav><div class="gd-body"></div></div>
      <div class="tr-dialog-foot"><span class="tr-muted" style="font-size:12px">${esc(isEn() ? 'How to write your own fields and exclusions (this guide is in Korean for now)' : '사용자 지정 영역 · 제외를 적는 법')}</span><span class="tr-grow"></span><button class="tr-btn" data-close>${esc(T('common.close'))}</button></div></div>`;
    layer.classList.remove('hidden');
    if (!PAGES.includes(page)) pushPage(page);
    const body = layer.querySelector('.gd-body');
    const show = (k) => {
      body.innerHTML = `<h3>${SECTIONS.find((x) => x[0] === k)[1]}</h3>` + BODY[k];
      body.scrollTop = 0;
      layer.querySelectorAll('.gd-link').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      body.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => show(a.dataset.go)));
    };
    layer.querySelectorAll('.gd-link').forEach((b) => b.addEventListener('click', () => show(b.dataset.k)));
    layer.querySelector('[data-close]').addEventListener('click', close);
    show(BODY[start] ? start : 'basics');
  }
  const page = { titleKey: 'set.guide', kind: 'guide', close: async () => { close(); return true; } };
  function close() { if (layer) { layer.classList.add('hidden'); layer.innerHTML = ''; } popPage(page); }
  return { open, close };
})();
