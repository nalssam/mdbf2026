# 초등사회 교육콘텐츠 클라우드 @nalssam (자료실 허브)

초등 사회 3~6학년 **단원 마무리 활동**을 모아 두는 정적(static) 웹 허브입니다.
제작: **몽당분필 날쌤**. 단원마다 3종을 제공하는 것을 목표로 합니다:
**🗝 방탈출 게임 · 🎨 비주얼싱킹 색칠 학습지 · ✂️ 페이퍼크래프트 도안**.

- 공개 주소(배포 시): `https://nalssam.github.io/mdbf2026/social/`
- 서버 불필요 — GitHub Pages가 `public/*`를 그대로 게시합니다.
- 로그인 기능은 없습니다. "몽당분필 회원 전용 학습자료" 배지는 **안내용**이며,
  실제 접근 제한은 몽당분필 사이트에서 회원에게만 이 링크를 노출하는 방식으로 합니다.

## 폴더 구조

```
public/social/
├── index.html         # 화면 껍데기 (건드릴 일 거의 없음)
├── css/hub.css        # 디자인
├── js/app.js          # 화면 그리는 코드 (건드릴 일 거의 없음)
├── js/curriculum.js   # ★ 단원 목록·자료 연결·관련 성취기준을 편집하는 유일한 파일 ★
├── js/standards.js    # 2022 개정 사회과 성취기준 조회표 (참고용, 자동 생성 데이터)
├── dataset/           # 원본 데이터·출처 안내 (social-2022.json, ATTRIBUTION.md)
├── units/             # 단원별 자료
│   └── 5-2-2/         #   6·25 단원 (첫 완성 단원 — 3종 전부 공개)
│       ├── visual/    #   비주얼싱킹 색칠 학습지 (index.html + visual.pdf, A4 2쪽)
│       └── craft/     #   암호 돌림판 페이퍼크래프트 (index.html + craft.pdf, A4 2쪽)
└── templates/
    └── print/         # 공용 A4 인쇄 템플릿 (print-base.css + 제작 가이드 README)
```

## 자주 하는 편집 — `js/curriculum.js` 한 파일만

### 1) 단원 목록 바꾸기
`grades` 배열에서 학년 → `semesters`(학기) → `units`(단원)를 고칩니다.
각 단원의 `id`는 `"<학년>-<학기>-<순번>"` 형식이며, 그 단원 자료가 들어갈 폴더 이름
(`units/<id>/`)으로도 쓰이니 되도록 바꾸지 마세요.

> 현재 목록은 2022 개정 교육과정을 참고한 **가안**입니다. 실제 채택 교과서(예: 비상교육)
> 목차가 확정되면 이 파일의 단원들을 그에 맞게 교체하세요.

### 2) 자료 하나를 "공개"로 바꾸기 (딱 두 줄)
해당 단원의 `deliverables`에서:
```js
escape: { status: "ready", href: "units/5-2-2/escape/" }
```
- `status`를 `"ready"`로 바꾼다
- `href`에 자료 위치(이 폴더 기준 상대경로)를 넣는다
- `note`(선택)를 넣으면 타일 아래 작은 설명이 표시됩니다.

`status`가 `"ready"`가 아니거나 `href`가 없으면 타일은 자동으로 "준비 중"(비활성)으로 보입니다.

### 3) 자료 파일 두는 위치
- 단원별 자료: `units/<id>/…` (예: `units/5-2-2/visual.pdf`)
- 예외: 기존 6·25 방탈출은 상위 폴더에 있어 `../korean-war-escape/`로 연결돼 있습니다.

### 4) 단원별 "관련 성취기준(참고)" 고치기
각 단원의 `standards` 배열에 2022 개정 사회과 성취기준 코드를 넣으면, 그 단원 카드에
"관련 성취기준(참고)" 접이식 블록이 표시됩니다.
```js
{ id: "5-2-2", title: "…", standards: ["[6사06-01]", "[6사06-02]", "[6사07-01]", "[6사07-02]"] }
```
- 코드 → 요약/학년군/국가단원명 은 `js/standards.js`(`window.MDBF_STANDARDS`)에서 자동으로 찾습니다.
- ⚠ 데이터셋은 **학년군(3–4 / 5–6) + 국가교육과정 단원** 축이라 개별 학년/학기가 없습니다.
  그래서 현행 단원 ↔ 성취기준 연결은 **가안(검수 필요)**입니다 — 이 배열만 고쳐 교정하세요.
- 요약문은 공식 성취기준 **문구가 아니라** 데이터셋의 비공식 요약입니다(코드는 공식 번호).

## 데이터 출처 / 라이선스 (반드시 보존)
`js/standards.js`·`dataset/social-2022.json` 의 성취기준 참고 데이터 출처:
- 성취기준 코드·배치: **교육부 고시 제2022-33호 [별책 7] 사회과 교육과정** (배포: NCIC, 접근일 2026-07-10)
- 데이터셋: **Korean Elementary Learning Map** — © 2026 DECK(github.com/DECK6), **MIT** ·
  취득: github.com/nalssam/korean-elementary-learning-map @ `3ef0563`
- 학습 그래프 접근은 Marble Skill Taxonomy(© Generative Spark, Inc.)에서 영감을 받음.
- 본 자료는 교육부·국가교육위원회·NCIC의 공식/승인물이 **아닙니다**.
- 전체 안내: [`dataset/ATTRIBUTION.md`](dataset/ATTRIBUTION.md)

> `js/standards.js` 는 원본 데이터에서 추출·생성된 파일입니다. 성취기준 목록 자체를 바꿀 일은
> 거의 없지만, 필요하면 `dataset/social-2022.json` 을 원본으로 삼아 다시 생성하세요.

## 인쇄 자료(비주얼싱킹·페이퍼크래프트) 만드는 법

첫 완성 예시는 6·25 단원(`units/5-2-2/`)입니다. 새 단원 인쇄 자료는:

1. `units/5-2-2/visual/`(또는 `craft/`)를 `units/<새id>/…`로 복사해 내용만 교체
2. 공용 스타일은 `templates/print/print-base.css` — 고치면 각 인쇄 페이지 링크의 `?v=` 숫자를 손으로 올릴 것
3. PDF 재생성(Playwright `page.pdf`, A4) 후 같은 폴더에 커밋
4. `curriculum.js`에서 해당 deliverable을 `ready` + `href`로 flip

자세한 규약은 [`templates/print/README.md`](templates/print/README.md) 참고.

## 앞으로 (로드맵)
- `templates/escape/` — 6·25 게임을 데이터 기반 엔진으로 일반화 (단원별 config만 교체)
- 단원별 3종 양산: 확정 교과서 목차 기준, 단원마다 방탈출·비주얼싱킹·페이퍼크래프트 제작

`curriculum.js`의 `href`는 자유로운 상대경로라, 어떤 템플릿이 생겨도 스키마 변경 없이 바로 연결됩니다.
