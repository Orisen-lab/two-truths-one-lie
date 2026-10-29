/* 主持人共用：後端呼叫與計分。本機版內含管理金鑰；線上版由「發佈線上版.sh」把金鑰清空，改成第一次打開時輸入主持人密碼 */
window.TT = (function () {
  var CONFIG = {
    endpoint: 'https://script.google.com/macros/s/AKfycbwE8ss60BNEJQL7Ahfd8xZuYJbYF-5VkZpKD0DgzsqunaWLakGvaHsSezNazEka1U5yKg/exec',
    key: '',
    playUrl: 'https://orisen-lab.github.io/two-truths-one-lie/play.html',
    relay: 'https://tt1f-relay.tinyck-863.workers.dev/state'
  };

  /* 進度中繼：每次狀態有變就把「手機該看到的畫面」推上去，手機讀這份比讀 Google 快很多。
     seq 用「這份狀態是什麼時候的」：操作當下推的用現在時間，後端回應用送出請求的時間，
     晚到的舊回應不會蓋掉剛剛推的新狀態。 */
  var entriesCache = null;
  var lastPushed = '';
  var seqN = 0;
  function publish(st, at) {
    if (!st || !entriesCache || !CONFIG.key) return;
    var pub = { ok: true, phase: st.phase, round: st.round + 1, total: st.order.length, epoch: st.epoch || 0 };
    if (st.round >= 0) {
      var k = key(st.order[st.round]);
      var e = entriesCache.filter(function (x) { return key(x.name) === k; })[0];
      if (e) {
        pub.protagonist = e.name;
        pub.things = e.things;
        pub.target = e.target;
        if (st.phase === 'revealed') { pub.truths = e.truths; pub.answer = e.answer + 1; }
      }
    }
    var text = JSON.stringify(pub);
    if (text === lastPushed) return;
    lastPushed = text;
    fetch(CONFIG.relay, { method: 'POST', body: JSON.stringify({ key: CONFIG.key, seq: (at || Date.now()) * 1000 + (seqN++ % 1000), state: pub }) })
      .catch(function () { lastPushed = ''; });
  }

  // 後端錯誤碼轉成主持人看得懂的話
  var ERRORS = {
    already_revealed: '這一輪已經揭曉，不能再開放或停止作答',
    no_round: '還沒進入任何一輪',
    bad_round: '已經是第一輪或最後一輪了',
    forbidden: '主持人密碼不對，請重新登入',
    server_error: '後端忙不過來，請再按一次'
  };

  function admin(op, extra) {
    var sentAt = Date.now();
    var body = { a: 'admin', key: CONFIG.key, op: op };
    for (var k in (extra || {})) body[k] = extra[k];
    return fetch(CONFIG.endpoint, { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error(ERRORS[res && res.error] || '沒有成功，請再按一次');
        if (res.entries) entriesCache = res.entries;
        if (res.state) publish(res.state, sentAt);
        return res;
      }, function (err) {
        if (err && /fetch|network|load/i.test(err.message)) throw new Error('連不上網路，請確認連線後再試一次');
        throw err;
      });
  }

  // 線上版沒有內建金鑰：讀這台電腦記住的密碼，沒有就跳出登入框
  var STORE = 'tt1f-host-key';
  var online = !CONFIG.key;
  function ready() {
    if (CONFIG.key) return Promise.resolve();
    var saved = '';
    try { saved = localStorage.getItem(STORE) || ''; } catch (e) {}
    if (saved) {
      CONFIG.key = saved;
      return admin('progress').then(function () {}, function () { CONFIG.key = ''; return login(); });
    }
    return login();
  }
  function login() {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.setAttribute('style', 'position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:#000;font-family:"Noto Sans TC","PingFang TC",sans-serif;padding:16px');
      box.innerHTML =
        '<form style="width:min(100%,380px);background:#1A1917;border:1px solid #34322E;border-radius:24px;padding:28px 24px;display:grid;gap:14px;color:#F4F3EF">' +
          '<h1 style="margin:0;font-size:22px;font-weight:900">主持人登入</h1>' +
          '<p style="margin:0;font-size:14px;color:#A9A59C;line-height:1.6">輸入主持人密碼，這台電腦之後就不用再輸入。</p>' +
          '<input type="password" autocomplete="current-password" required style="font:inherit;font-size:16px;color:#F4F3EF;background:#121212;border:1px solid #34322E;border-radius:10px;padding:12px 14px">' +
          '<button type="submit" style="font:inherit;font-size:16px;font-weight:900;color:#151515;background:#C9A43B;border:0;border-radius:999px;padding:12px;cursor:pointer">進入</button>' +
          '<p data-msg style="margin:0;font-size:14px;color:#E58A7D;min-height:1.6em"></p>' +
        '</form>';
      document.body.appendChild(box);
      var form = box.querySelector('form');
      var input = box.querySelector('input');
      var msg = box.querySelector('[data-msg]');
      input.focus();
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        CONFIG.key = input.value.trim();
        msg.textContent = '確認中…';
        admin('progress').then(function () {
          try { localStorage.setItem(STORE, CONFIG.key); } catch (e) {}
          box.remove();
          resolve();
        }, function (err) {
          CONFIG.key = '';
          msg.textContent = /密碼/.test(err.message) ? '密碼不對，請再確認一次' : err.message;
        });
      });
      box.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
    });
  }
  function logout() {
    try { localStorage.removeItem(STORE); } catch (e) {}
    location.reload();
  }

  function key(v) {
    return String(v == null ? '' : v).normalize('NFKC').replace(/^'/, '').replace(/\s+/g, '').toLowerCase();
  }

  // 由後端原始資料算出每一輪、每個人的成績與三大獎
  function compute(data) {
    var st = data.state;
    var byName = {};
    data.entries.forEach(function (e) { byName[key(e.name)] = e; });

    var rounds = st.order.map(function (name, i) {
      var e = byName[key(name)] || null;
      var ans = data.answers.filter(function (a) { return a.round === i + 1; });
      var revealed = st.revealed.indexOf(i) >= 0;
      var correct = e ? ans.filter(function (a) { return a.choice - 1 === e.answer; }).length : 0;
      return {
        index: i, name: name, entry: e, answers: ans, revealed: revealed,
        answered: ans.length, correct: correct, fooled: ans.length - correct
      };
    });

    var players = data.entries.map(function (e) {
      var k = key(e.name);
      var marks = rounds.map(function (r) {
        if (key(r.name) === k) return 'self';
        var a = r.answers.filter(function (x) { return key(x.voter) === k; })[0];
        if (!r.revealed) return a ? 'wait' : 'none';
        if (!a) return 'none';
        return a.choice - 1 === r.entry.answer ? 'ok' : 'bad';
      });
      var score = marks.filter(function (m) { return m === 'ok'; }).length;
      return { name: e.name, dept: e.dept, marks: marks, score: score };
    });

    var revealedRounds = rounds.filter(function (r) { return r.revealed; });
    var awards = { best: [], worst: [], actor: [] };
    if (revealedRounds.length) {
      var hi = Math.max.apply(null, players.map(function (p) { return p.score; }));
      var lo = Math.min.apply(null, players.map(function (p) { return p.score; }));
      awards.best = players.filter(function (p) { return p.score === hi; }).map(function (p) { return { name: p.name, value: p.score }; });
      // 猜錯王只算有作答過的人，避免缺席的人被算進來
      var active = players.filter(function (p) { return p.marks.some(function (m) { return m === 'ok' || m === 'bad'; }); });
      var pool = active.length ? active : players;
      lo = Math.min.apply(null, pool.map(function (p) { return p.score; }));
      awards.worst = pool.filter(function (p) { return p.score === lo; }).map(function (p) { return { name: p.name, value: p.score }; });
      var top = Math.max.apply(null, revealedRounds.map(function (r) { return r.fooled; }));
      awards.actor = revealedRounds.filter(function (r) { return r.fooled === top; }).map(function (r) { return { name: r.name, value: r.fooled }; });
    }

    var ranked = players.slice().sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name, 'zh-Hant'); });
    var missing = data.entries.filter(function (e) {
      return !st.order.some(function (n) { return key(n) === key(e.name); });
    }).map(function (e) { return e.name; });

    return { state: st, rounds: rounds, players: players, ranked: ranked, awards: awards, missing: missing, revealedCount: revealedRounds.length };
  }

  return { config: CONFIG, admin: admin, compute: compute, key: key, ready: ready, logout: logout, online: online, publish: publish };
})();
