-- v13.375 💬 참여자는 대화를 처음부터 모두 봄 (업무용 — 화제를 파악할 수 있게)
--   v13.359 의 '이전 대화 안 보여 주기'(hist_from) 로 가려 두었던 사람도 모두 풂. 칸은 남겨 두되 더 이상 쓰지 않음
UPDATE chat_members SET hist_from = NULL WHERE hist_from IS NOT NULL;
