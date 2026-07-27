# 데이터 출처 및 라이선스 (사회 성취기준 참고자료)

이 폴더의 `social-2022.json` 과 상위 `js/standards.js` 의 성취기준 참고 데이터는
아래 출처에서 가져와 몽당분필 날쌤 자료실에 **참고자료**로 통합한 것입니다.

## 1. 데이터셋 (MIT)

- **이름**: Korean Elementary Learning Map (한국 초등 학습지도)
- **저작권**: © 2026 DECK (github.com/DECK6) — [MIT License](https://opensource.org/licenses/MIT)
- **취득 경로**: https://github.com/nalssam/korean-elementary-learning-map
  — `data/kr/workstreams/social.json` @ commit `3ef0563084aa2a9baaa47da2c1ec0ebf5d7edc5c`
- MIT 라이선스 고지 (원문):

  > MIT License
  >
  > Copyright (c) 2026 DECK (github.com/DECK6)
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction … The above copyright notice and this
  > permission notice shall be included in all copies or substantial portions of
  > the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND …

  전체 라이선스 문구는 데이터셋 저장소의 `LICENSE` 파일을 참조하세요.

## 2. 학습 그래프 접근 감사 (Marble)

데이터셋의 학습 그래프 접근은 **Marble Skill Taxonomy**
(`withmarbleapp/os-taxonomy`, © Generative Spark, Inc., https://withmarble.com)
에서 **영감**을 받았습니다. Marble의 데이터/저작 콘텐츠를 복제·번역·개작하지 않았으며,
감사는 접근 방식에 한합니다.

## 3. 한국 공식 교육과정 출처 (공개 공식 자료 · cleared)

성취기준 **코드와 학년군·단원 배치**는 다음 국가 공식 자료에서 확인된 것입니다.
(공식 성취기준 **문구는 대량 재수록하지 않으며**, `standards.js`/`social-2022.json`의
`summary`는 공식 문구가 아닌 **데이터셋 작성 비공식 요약**입니다.)

- **고시/별책**: 교육부 고시 제2022-33호 **[별책 7] 사회과 교육과정**
- **발행**: 교육부(Ministry of Education)
- **배포처**: NCIC 국가교육과정정보센터 (https://ncic.re.kr/)
- **직접 URL**: https://ncic.re.kr/inv/org/download.do?year=2022&seq=10003800&orgType=ogi4
- **접근일**: 2026-07-10
- **첨부번호**: 10003800 · **파일명**: `[별책7] 사회과 교육과정.pdf`
- **SHA-256**: `a852e8da3e6aea7d1c95690dcae140be02e014b779ac2e5cc0801200cfb16923`

## 4. 비공식·비승인 고지

본 자료실과 여기 통합된 데이터는 **교육부·국가교육위원회·NCIC의 공식 간행물/번역/승인
제품이 아닙니다.** 해당 기관이 제작에 참여했거나 후원·보증했다는 의미로 사용할 수 없습니다.

## 5. 자료실에서의 사용 방식 (참고)

- 현행 학년→학기→단원 구조는 **그대로 유지**하고, 각 단원에 관련 성취기준을 **참고**로만 덧붙였습니다.
- 데이터셋은 **학년군(3–4 / 5–6) + 국가교육과정 단원** 축이라 개별 학년/학기 정보가 없습니다.
  따라서 현행 단원 ↔ 2022 개정 성취기준 연결은 **가안(검수 필요)**이며,
  `public/social/js/curriculum.js` 한 파일에서 교정할 수 있습니다.
