/* FINAL FLOW HOTFIX
   - 1/2/3 게임을 모두 클리어하면 엔딩 페이지로 즉시 이동
   - 기존 게임 선택 복귀 흐름은 3개 모두 완료 전까지만 유지
*/
(function finalFlowHotfix(){
  const completed = window.__sonyulCompletedGames || new Set();
  window.__sonyulCompletedGames = completed;

  function markCompleted(){
    try {
      const g = String(currentGame || currentStage || 1);
      completed.add(g);
      if (typeof clearedGames !== 'undefined' && clearedGames && typeof clearedGames.add === 'function') {
        clearedGames.add(Number(g));
      }
    } catch(e) {}
  }

  function allCompleted(){
    return completed.has('1') && completed.has('2') && completed.has('3');
  }

  function goFinal(){
    try { clearInterval(timerInterval); } catch(e) {}
    try { cancelAnimationFrame(rafId); } catch(e) {}
    try { hideHUD(); } catch(e) {}
    try { playBGM(); } catch(e) {}
    if (typeof showScreen === 'function') showScreen('finalScreen');
    else {
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      const final = document.getElementById('finalScreen');
      if (final) final.classList.remove('hidden');
    }
  }

  const previousShowStageClear = window.showStageClear;
  window.showStageClear = function(){
    markCompleted();

    if (allCompleted()) {
      goFinal();
      return;
    }

    if (typeof previousShowStageClear === 'function') {
      const result = previousShowStageClear.apply(this, arguments);
      const next = document.getElementById('nextBtn');
      if (next) next.textContent = '🎮 게임 선택';
      return result;
    }
  };

  window.showFinal = goFinal;

  const previousNextStage = window.nextStage;
  window.nextStage = function(){
    markCompleted();

    if (allCompleted()) {
      goFinal();
      return false;
    }

    if (typeof previousNextStage === 'function') return previousNextStage.apply(this, arguments);
    if (typeof showScreen === 'function') showScreen('stageSelectScreen');
    return false;
  };
})();
