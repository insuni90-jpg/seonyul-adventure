/* =========================================================
   Stage Select Navigation Hard Fix
   - 중복 HTML/로컬 file 환경에서 카드 클릭이 무시되거나 잘못된 문서 조각으로 이동하는 문제 방지
   - BGM 로드 오류와 무관
   ========================================================= */
(function stageSelectNavigationHardFix(){
  function showOnlyScreen(id) {
    document.querySelectorAll('.screen').forEach(function(screen) {
      screen.classList.add('hidden');
      screen.style.setProperty('display', 'none', 'important');
      screen.style.pointerEvents = 'none';
    });
    var target = document.getElementById(id);
    if (target) {
      target.classList.remove('hidden');
      target.style.removeProperty('display');
      target.style.display = 'flex';
      target.style.pointerEvents = 'auto';
      target.style.zIndex = '50';
    }
    var muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
      muteBtn.style.display = 'flex';
      muteBtn.style.pointerEvents = 'auto';
      muteBtn.style.zIndex = '99999';
    }
  }

  function setIntroScene(gameNum) {
    var cfg = (window.STAGE_CONFIG && STAGE_CONFIG[gameNum - 1]) ? STAGE_CONFIG[gameNum - 1] : null;
    if (!cfg) return;

    var badge = document.getElementById('introStageBadge');
    var goal = document.getElementById('introGoalBadge');
    if (badge) badge.textContent = '🏁 ' + cfg.name;
    if (goal) goal.textContent = '⭐ 별 ' + cfg.starGoal + '개 수집 · ⏱️ ' + cfg.timeLimit + '초';

    [1,2,3].forEach(function(n){
      var scene = document.getElementById('introScene' + n);
      if (scene) scene.style.display = (n === gameNum ? 'flex' : 'none');
    });
  }

  window.safeSelectGame = function(gameNum) {
    gameNum = Number(gameNum) || 1;
    window.currentGame = gameNum;
    window.currentStage = gameNum;
    setIntroScene(gameNum);
    if (typeof hideHUD === 'function') hideHUD();
    showOnlyScreen('stageIntroScreen');
  };

  function bindCards() {
    document.querySelectorAll('.game-card').forEach(function(card) {
      var gameNum = Number(card.getAttribute('data-game') || (card.className.match(/g([123])/) || [])[1] || 1);
      card.removeAttribute('onclick');
      card.style.pointerEvents = 'auto';
      card.style.cursor = 'pointer';

      ['click','pointerup','touchend'].forEach(function(evt) {
        card.addEventListener(evt, function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          window.safeSelectGame(gameNum);
          return false;
        }, {capture:true, passive:false});
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(bindCards, 0); });
  } else {
    setTimeout(bindCards, 0);
  }
})();
