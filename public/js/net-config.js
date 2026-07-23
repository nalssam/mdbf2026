// BlockQuest 실시간 네트워킹 설정
// 서버 없이(정적 호스팅) 학생들이 같은 학급 코드로 동시에 한 월드에 접속할 수 있도록
// Supabase Realtime(브로드캐스트+프레즌스)을 멀티플레이 전송 계층으로 사용한다.
//
// 여기 담긴 anon 키는 "공개용" 키다(클라이언트 노출을 전제로 설계됨).
// 이 전용 프로젝트에는 데이터 테이블이 없고 Realtime 브로드캐스트/프레즌스 채널만 쓰므로
// 노출돼도 유출될 데이터가 없다. Realtime WebSocket 인증은 예전부터 JWT anon 키를 쓰므로
// 모든 클라이언트 버전에서 확실히 동작하도록 anon 키(JWT)를 사용한다.
// 실제 서버(Node)가 돌아가는 환경에서는 이 설정을 쓰지 않고 Socket.IO로 동작한다.
window.BQ_NET = {
  supabaseUrl: 'https://edxftciitwqrzoqasqwn.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkeGZ0Y2lpdHdxcnpvcWFzcXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Mzk1NjgsImV4cCI6MjEwMDMxNTU2OH0.9_ZZ2sXIHpqDmbKxw76Kt5jDoXnFpFnLBpevFBQVCeI',
};
