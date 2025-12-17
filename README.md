# Okay Lottery Back (Data Server)

미국 복권 **Powerball**과 **Mega Millions**의 당첨 정보를 수집하고, 정적 JSON 파일로 제공하는 백엔드(데이터) 저장소입니다.  
GitHub Actions를 통해 매일 자동으로 최신 데이터를 수집하며, **GitHub Pages**를 활용하여 별도의 서버 비용 없이 API처럼 데이터를 조회할 수 있습니다.

---

## 🚀 API 사용 방법 (Integration)

이 저장소의 **GitHub Pages** 설정을 활성화(`Settings > Pages > Source: main`)하면, 아래 URL 패턴으로 어디서든 데이터를 가져올 수 있습니다.

**Base URL**: `https://<GITHUB_USERNAME>.github.io/okaylottery-back`

### 1. 최신 회차 정보 (Latest Draw)
가장 최근의 추첨 결과를 조회합니다.
- **Powerball**: `GET /data/powerball/latest.json`
- **Mega Millions**: `GET /data/megamillions/latest.json`

### 2. 특정 날짜 정보 (Specific Date)
특정 날짜의 추첨 결과를 조회합니다.
- **Powerball**: `GET /data/powerball/2025-12-16.json`
- **Mega Millions**: `GET /data/megamillions/2025-12-12.json`

### 3. 전체 회차 목록 (Index)
수집된 모든 회차의 날짜 목록을 조회합니다. (내림차순 정렬)
- **Format**: `GET /data/<game>/index.json`
- **Response**:
  ```json
  {
    "game": "powerball",
    "draws": ["2025-12-16", "2025-12-13", ...],
    "total": 150,
    "updatedAt": "2025-12-16T12:00:00.000Z"
  }
  ```

---

## 📊 데이터 구조 (Schema)

### 1. Powerball (`/data/powerball/*.json`)
```json
{
  "game": "powerball",
  "drawDate": "2025-12-16",
  "numbers": [10, 20, 30, 40, 50],
  "powerBall": 5,
  "powerPlay": 2, // 2x, 3x...
  "jackpot": {
    "estimated": 70000000,
    "cash": 35000000,
    "winners": 0
  },
  "prizeTiers": [
    // 0등(Jackpot) ~ 8등 상세 당첨 정보 (당첨금, 당첨자 수 등)
    {
      "tier": 0,
      "matchWhite": 5,
      "matchSpecial": true,
      "prize": { "base": "JACKPOT", "multiplier": "JACKPOT" },
      "winners": { "base": 0, "multiplier": 0 }
    },
    ...
  ],
  "winners": [
    // 당첨 지역 정보 (API 제공 시)
    { "title": "Match 5", "description": "$1 Million Winners", "locations": "NY, CA" }
  ],
  "videoCode": "VIDEO_ID", // YouTube 영상 ID (없으면 null)
  "fetchedAt": "2025-12-16T10:00:00.000Z"
}
```

### 2. Mega Millions (`/data/megamillions/*.json`)
```json
{
  "game": "megamillions",
  "drawDate": "2025-12-12",
  "numbers": [5, 10, 15, 20, 25],
  "megaBall": 7,
  "megaplier": 3, // 3x
  "jackpot": {
    "estimated": 80000000,
    "cash": 40000000,
    "strValue": "$80 Million"
  },
  "prizeTiers": [
    // 0 ~ 8 Tier 상세 정보
    {
      "tier": 1,
      "prize": "$1 Million",
      "winners": 0,
      "multiplierWinners": 0
    },
    ...
  ],
  "winnerLocations": [
    // 당첨 지역 정보
    { "type": "Match 5", "description": "$1 Million Winners", "locations": "NJ" }
  ],
  "videoCode": "VIDEO_ID", // YouTube 영상 ID
  "fetchedAt": "2025-12-16T10:00:00.000Z"
}
```

---

## 🛠 로컬 실행 및 개발 (Setup)

### 1. 설치
```bash
npm install
```

### 2. 데이터 수집 실행 (Manual Fetch)
*   **Powerball** (오늘 날짜 기준 조회)
    ```bash
    node scripts/powerball.js
    ```
*   **Mega Millions** (최신 회차 자동 조회)
    ```bash
    node scripts/megamillions.js
    ```
    > **Note**: 이미 데이터가 존재하는 날짜는 `Skipping...` 메시지와 함께 수집을 건너뜁니다.

### 3. 과거 데이터 적재 (Backfill History)
*   자동으로 과거 데이터를 순차적으로 수집합니다.
    ```bash
    node scripts/history_powerball.js
    node scripts/history_megamillions.js
    ```

---

## ⚙️ 자동화 (Automation)
이 프로젝트는 **GitHub Actions**를 사용합니다.
*   **Schedule**: 매일 4:00, 16:00 (UTC) - 한국 시간 오후 1시, 새벽 1시 경 실행
*   **Workflow**:
    1. 최신 데이터 수집 (`scripts/*.js`)
    2. 변경 사항이 있는지 확인 (`git diff`)
    3. 변경 사항이 있을 경우에만 커밋 및 푸시
    4. 커밋 메시지에 실제 추첨 날짜 포함 (`Update ... data: 2025-12-16`)
