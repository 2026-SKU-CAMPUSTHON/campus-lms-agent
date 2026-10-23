# MySQL 로그인과 Oracle Cloud 배포

2026-10-22 사용자 결정: Supabase를 사용하지 않고 MySQL 8.4에 실제 계정과 학습 기록을 저장한다. Oracle Cloud 인스턴스에서 Docker Compose로 앱·MySQL·Caddy를 실행한다. 원격 배포 결과는 이 문서의 명령 준비와 구분하여 검증 기록에 남긴다.

2026-10-23에는 Oracle Ubuntu 22.04.5 ARM64(1 CPU·메모리 약 6GB·디스크 약 45GB)에 실제 배포했다. 앱·MySQL·Caddy와 Let's Encrypt 인증서는 정상이며 80 포트의 HTTP→HTTPS 이동을 외부에서 확인했다. 실제 기능·브라우저·컨테이너 교체·백업은 먼저 SSH의 TLS 터널로 검증했다. OCI 대상 포트 443 수신 규칙 수정 후 같은 날 20:23 KST에 터널/프록시 없는 외부 HTTPS health 200, 교수·학생 로그인, 저장된 오답 2개와 교수 답변, 교수/학생 PDF 다운로드, 학생별 격리와 390px 화면 검사를 통과했다. 팀원은 [테스트 사이트](https://campus.146.56.101.124.sslip.io)에 접속할 수 있다. 비밀번호·초대 코드는 로컬 비공개 파일로만 제공한다.

## 로그인과 권한

최초 교수 계정은 공개 가입 화면에서 만들지 않는다. 서버의 `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD`(12~128자), `BOOTSTRAP_NAME`, `BOOTSTRAP_COURSE`로 한 번 생성한다. 같은 이메일이 이미 있으면 비밀번호·역할을 덮어쓰지 않는다. 첫 강의에는 15개 주차가 생성된다. 첫 로그인 뒤 `BOOTSTRAP_EMAIL`과 `BOOTSTRAP_PASSWORD`를 함께 비워도 계정이 유지된다. 한 값만 제거하면 시작 시 설정 오류가 발생한다. 실제 Oracle 배포에서는 두 값을 비우고 MySQL·앱을 교체한 뒤 기존 계정·세션을 다시 확인했다.

교수는 화면의 **강의 참여·팀원 초대**에서 학생 또는 교수 초대 코드를 발급한다. 코드는 7일간 유효하며 한 사람이 한 번 사용한다. 저장소에는 원문 대신 SHA-256 해시만 남긴다. 신규 사용자는 이름·이메일·12자 이상 비밀번호·초대 코드로 가입한다. 기존 사용자는 로그인한 뒤 초대 코드로 다른 강의에 참여한다. 역할은 서버에 저장된 초대로 정하며 가입 요청의 `role` 필드는 거부한다. 교수 권한이 있는 계정은 새 강의를 만들 수 있다.

이메일을 소문자로 정규화하고 비밀번호는 무작위 salt와 scrypt(N=32768,r=8,p=1,64byte)로 저장한다. 브라우저에는 8시간 무작위 세션 쿠키만 발급하고 DB에는 세션 해시·소유자·만료를 저장한다. 배포 쿠키는 `__Host-campus_session`, Secure, HttpOnly, SameSite=Strict, Path=/다. 로그아웃하면 서버 세션을 삭제한다. 로그인·가입은 IP당 15분 20회로 제한한다. 현재 서버 한 대를 기준으로 한 제한이다.

학생은 본인 답안·오답·Q&A만 조회하고 교수는 담당 강의의 자료·초안·레포트를 조회한다. 학생에게 제출 전 정답·풀이·출처를 반환하지 않는다. MySQL의 외래키·고유 제약과 서버 권한 검사를 사용한다. 브라우저에서 DB에 직접 접속하지 않으며 MySQL 포트는 공개하지 않는다. MySQL이 Supabase의 RLS나 학교 SSO를 제공한다고 가정하지 않는다. 이메일 인증·비밀번호 재설정 메일·학교 SSO는 이번 구현 범위에 포함하지 않는다.

## 저장과 동시성

- MySQL: 사용자·비밀번호 해시·세션·강의·주차·수강 관계·초대·자료/전사 메타데이터·퀴즈 초안·게시 문제·답안·Q&A·작업 상태·중복 요청 결과.
- `app_data` 볼륨 `/data`: 강의 원본, 녹음·영상, 모델 캐시. 기본 사이트에서 이 디렉터리를 정적 공개하지 않는다.
- `mysql_data` 볼륨: MySQL 데이터. 앱 재빌드·컨테이너 교체와 분리한다.
- `caddy_data`, `caddy_config`: HTTPS 인증서와 프록시 상태.

`mysql/migrations`의 번호 순 SQL을 서버 시작 시 적용한다. 이름·SHA-256을 기록하며 적용한 파일을 수정하면 시작을 거부한다. 이후 변경은 새 파일로 추가한다. 기존 앱 JSON을 LONGTEXT+JSON_VALID로 보존하고 삽입 순서는 MySQL의 invisible `rowid` 열로 유지한다. MySQL 어댑터는 기존 JSON scalar 조회와 jobs upsert 구문만 변환하며 사용자 값은 바인딩한다.

저장소의 모든 앱 SQL 호출을 비동기로 전환했다. 트랜잭션은 같은 연결을 사용하고 전역 쓰기 잠금으로 초대 소비·버전 검사·중복 제출·동일 요청 결과를 직렬화한다. 중복 요청 조회도 트랜잭션 안에서 수행한다. AI/전사 작업은 커밋 후 시작하며 롤백한 요청은 작업을 실행하지 않는다. PDF의 여러 조회는 하나의 트랜잭션 스냅샷으로 묶는다. 추가 질문은 기존 1회 제한을 유지한다.

현재 작업 큐는 앱 프로세스 안에 있으므로 **앱은 한 개만 실행**한다. DB의 runtime named lock으로 두 번째 프로세스 시작을 차단하며 연결을 잃으면 종료한다. 재시작 시 진행 중 작업은 실패로 표시하고 기존 재시도 동작을 사용한다. 자동 작업 재확보·무중단 다중 서버 큐를 구현한 것은 아니다.

기존 `.data/campus.sqlite`와 로컬 강의·학생 체험 기록은 보존한다. 체험 UUID·공유 계정을 실제 가입 계정으로 자동 이관하지 않는다. 배포는 실제 계정의 새 강의로 시작하며 필요한 강의 자료는 권한을 가진 교수가 등록한다.

## 로컬 MySQL 실행

Node 24.13 이상과 Python 의존성을 설치한 뒤 다음 환경을 설정한다. 값은 채팅이나 Git에 저장하지 않는다.

```dotenv
ENABLE_DEMO_AUTH=false
MYSQL_URL=mysql://campus:URL_ENCODED_PASSWORD@127.0.0.1:3306/campus
BOOTSTRAP_EMAIL=your-address@example.com
BOOTSTRAP_PASSWORD=YOUR_RANDOM_PASSWORD
BOOTSTRAP_NAME=담당 교수
BOOTSTRAP_COURSE=팀 테스트 강의
```

`npm run dev`로 실행한다. 원격 DB 연결은 `MYSQL_TLS=true`, 필요하면 `MYSQL_SSL_CA=/absolute/path/ca.pem`을 설정한다. 인증서 검증을 비활성화하는 옵션은 제공하지 않는다. 서버 내부 Docker 네트워크의 MySQL은 외부 포트를 열지 않는다. 기존 체험 화면은 `ENABLE_DEMO_AUTH=true`로만 유지하며 production에서는 체험 인증·SQLite 시작을 거부한다.

## Oracle 서버 준비와 배포

Ubuntu 24.04 인스턴스, SSH 접속, `sudo`, 영구 디스크, 서버를 가리키는 DNS 이름을 준비한다. 음성 전사를 함께 실행하므로 메모리 8GB 이상과 여유 디스크 30GB 이상을 기준으로 한다. 실제 부하는 강의 길이와 파일 크기로 별도 측정한다. 인터넷에서 TCP 80·443을 열고 SSH 22는 운영자가 접속할 수 있게 한다. OCI 보안 목록/NSG와 OS 방화벽 양쪽에서 확인한다. 3000·3306은 열지 않는다.

OCI 수신 규칙은 **소스 CIDR `0.0.0.0/0`·IP 프로토콜 TCP·소스 포트 전체·대상 포트 80 또는 443**로 각각 추가한다. 기본 stateful 규칙을 사용한다. 소스 포트에 443을 넣는 것은 웹 접속 허용과 다르다. 실제 사용 중인 VNIC의 서브넷/NSG에 연결된 규칙인지 확인한다. SSH 키는 VM 안의 설정을 바꾸는 수단이며 OCI 보안 목록 권한을 제공하지 않는다. 웹 프로세스가 정상인데 외부 연결이 시간 초과이면 VNIC의 패킷 수신 여부와 OCI 규칙을 나누어 확인한다.

`deploy/production.env.example`을 로컬 `.env.production`으로 복사하고 권한을 600으로 설정한다. `APP_HOST`는 스킴·경로 없는 호스트명이다. MySQL 비밀번호 두 개는 `openssl rand -hex 32`처럼 URL에 안전한 값으로 만들고 재배포에도 같은 값을 유지한다. 최초 교수 이메일·비밀번호와 기존 Claude·TypeSafe 키를 설정한다. 도메인이 없으면 공인 IP를 받은 뒤 HTTPS에 사용할 호스트명을 먼저 결정한다.

커밋한 코드를 SSH로 전송한다. 개인키 본문은 공유하지 않는다.

```bash
bash scripts/deploy-oracle.sh ubuntu@SERVER_IP /absolute/path/private.key /absolute/path/.env.production
```

스크립트는 `~/campus-lms/releases/<commit>`에 Git 추적 파일만 전송하고 환경 파일은 따로 600 권한으로 업로드한다. Ubuntu Docker 공식 저장소로 Engine·Compose를 설치하고 빌드/실행한다. 설치된 Docker가 있으면 재설치하지 않는다. SSH 호스트키는 최초 접속 때 등록하고 이후 변경을 거부한다. 현재 디렉터리는 `~/campus-lms/current`로 연결한다. 원격에서 private GitHub 토큰을 저장할 필요가 없다.

```bash
cd ~/campus-lms/current
sudo docker compose --env-file .env.production ps
sudo docker compose --env-file .env.production logs --tail=80 app caddy
```

Caddy는 호스트명의 HTTPS 인증서를 발급하고 HTTP를 HTTPS로 연결한다. 앱은 정확한 `APP_ORIGIN`으로 변경 요청의 Origin을 검사한다. 인증서 발급은 DNS·80/443 도달 가능 여부에 의존한다. 컨테이너 시작만 보고 배포 완료라고 하지 않는다.

배포 후 HTTPS 외부 접속, 체험 로그인 404, 최초 교수 로그인, 새 초대·다른 브라우저 가입, 교수 검토/게시·학생 제출·오답, 교수/학생 PDF, 다른 학생 데이터 차단을 확인한다. 앱 컨테이너를 다시 만든 뒤 세션·답안·Q&A·원본을 재확인한다. 처음 실제 음성을 전사할 때 Whisper 모델 다운로드가 필요할 수 있다. Docker 이미지에는 문서/PDF/미디어/YouTube Python 의존성과 FFmpeg·한글 글꼴을 포함한다. AMD64는 Container CI, ARM64는 실제 Oracle 인스턴스에서 빌드·라이브러리 import를 통과했다. ARM64에서 합성 음성 7.586초의 small 모델 전사도 완료했으며 긴 강의의 처리 시간 실측은 별도다.

## 백업과 재배포

```bash
cd ~/campus-lms/current
bash deploy/backup.sh
```

백업은 앱을 잠시 정지하고 MySQL dump와 원본 파일을 같은 시점에 묶는다. 모델 가중치 캐시는 제외한다. 종료/오류 시 앱을 다시 시작한다. 결과는 기본 `~/campus-backups/<UTC시각>`에 600/700 권한으로 남는다. 백업과 환경 파일은 별도 안전한 위치에 복사한다. 아직 자동 원격 백업·복구 훈련을 완료한 것은 아니다.

재배포는 같은 환경 파일·Compose 프로젝트 이름·영구 볼륨을 유지한다. `docker compose down -v`는 영구 데이터를 삭제하므로 배포 절차에 사용하지 않는다. DB 마이그레이션을 되돌려야 하는 경우 단순 코드 롤백으로 해결된다고 가정하지 말고 백업과 호환성을 먼저 확인한다.

## 검증 명령

기존 SQLite 회귀 검사는 `npm test`, `npm run test:e2e`다. 실제 MySQL 검사는 **폐기 가능한 이름 `campus_test` DB만** 허용하며 내용을 초기화한다.

```bash
MYSQL_TEST_URL='mysql://TEST_USER:TEST_PASSWORD@127.0.0.1:3306/campus_test' npm test
MYSQL_TEST_URL='mysql://TEST_USER:TEST_PASSWORD@127.0.0.1:3306/campus_test' npm run test:e2e:mysql
```

CI는 MySQL 8.4 서비스를 실행해 SQL·인증·권한·동시성·PDF·재시작 및 브라우저 흐름을 검사한다. 모델/YouTube 응답은 테스트에서만 주입한다. 원격 Oracle 배포와 실제 API 연결 성공은 별도 결과로 기록한다.

설정 근거: [MySQL2 연결 풀](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-pool), [Docker Ubuntu 설치](https://docs.docker.com/engine/install/ubuntu/), [Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https).
