/**
 * MAIN-world React Fiber Bridge (bridge.js) для Facebook 2026 — v2.4
 *
 * Достаёт скрытый числовой ID поста из React Fiber компонента CometSinglePostDialogRoot
 * (декодируя Base64 storyID: "UzpfSTEwMDA..." -> "S:_I100026447930727:2188835358674707:...")
 * и сохраняет его в атрибут data-fb-post-id на модальном окне.
 */
(() => {
  function decodeRelayBase64(b64) {
    try {
      const raw = atob(b64);
      if (raw.startsWith('S:_I')) {
        const nums = raw.match(/\d{8,25}/g);
        if (nums && nums.length >= 2) return nums[1];
        if (nums && nums.length === 1) return nums[0];
      }
      if (raw.startsWith('feedback:')) {
        const m = raw.match(/feedback:(\d{8,25})/);
        if (m) return m[1];
      }
    } catch (_) {}
    return null;
  }

  function extractIdFromPropsObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;

    if (typeof obj.storyID === 'string' && obj.storyID.startsWith('Uzpf')) {
      const id = decodeRelayBase64(obj.storyID);
      if (id) return id;
    }
    if (typeof obj.post_id === 'string' && /^\d{10,25}$/.test(obj.post_id)) {
      return obj.post_id;
    }
    if (typeof obj.story_fbid === 'string' && /^\d{10,25}$/.test(obj.story_fbid)) {
      return obj.story_fbid;
    }
    if (typeof obj.id === 'string') {
      if (obj.id.startsWith('Uzpf') || obj.id.startsWith('ZmVlZGJhY2s6')) {
        const id = decodeRelayBase64(obj.id);
        if (id) return id;
      }
    }

    for (const key of ['story', 'feedback', 'node', 'props', 'routeProps', 'hostableView']) {
      if (obj[key] && typeof obj[key] === 'object') {
        const nested = extractIdFromPropsObject(obj[key], depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }

  function findPostIdViaReactFiber(rootEl) {
    const candidates = [rootEl, ...Array.from(rootEl.querySelectorAll('div')).slice(0, 120)];
    for (const el of candidates) {
      const fiberKey = Object.keys(el).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (!fiberKey) continue;

      let fiber = el[fiberKey];
      for (let step = 0; step < 30 && fiber; step++) {
        const found = extractIdFromPropsObject(fiber.memoizedProps);
        if (found) return found;
        fiber = fiber.return;
      }
    }
    return null;
  }

  function syncPostIdsToDom() {
    const targets = [
      ...Array.from(document.querySelectorAll('div[role="dialog"]')),
      ...Array.from(document.querySelectorAll('div[role="main"]')),
    ];
    for (const target of targets) {
      if (target.getAttribute('data-fb-post-id')) continue;
      const postId = findPostIdViaReactFiber(target);
      if (postId) {
        target.setAttribute('data-fb-post-id', postId);
      }
    }
  }

  setInterval(syncPostIdsToDom, 600);
  syncPostIdsToDom();
})();
