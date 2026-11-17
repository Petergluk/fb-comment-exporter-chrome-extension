/**
  * FB Post & Nested Comments to Markdown Exporter + Reposts Opener v2.4 (Facebook Comet 2026)
  *
  * Что исправлено в v2.4:
  * 1. СНЯТА БЛОКИРОВКА ПОВТОРНОГО КЛИКА ПО КНОПКАМ ПАГИНАЦИИ (WeakSet bug fix):
  *    В React (Facebook Comet) кнопка внизу списка («Смотреть другие комментарии» / «Посмотреть еще комментарии»
  *    и «Посмотреть еще X ответов») при подгрузке следующей пачки переиспользует ТОТ ЖЕ САМЫЙ DOM-элемент!
  *    В v2.2/v2.3 добавление кнопки в WeakSet блокировало повторный клик по ней после 1-й пачки, поэтому
  *    на длинных тредах (251 комментарий) скрипт останавливался за ~30 комментариев до конца.
  *    Теперь вместо WeakSet используется умный счётчик (buttonClickStats): пока после клика растёт число
  *    комментариев или меняется текст кнопки, скрипт кликает её сколько угодно раз до самого конца!
  *
  * 2. ЧЕЛОВЕЧЕСКИЙ «ДОКРУТ» СКРОЛЛА (Scroll Wiggle) И ИСКЛЮЧЕНИЕ ОТСКОКА ВВЕРХ:
  *    Убрана строка lastReply.scrollIntoView({ block: 'end' }), которая оттягивала скролл чуть выше нижнего
  *    сенсора подгрузки Facebook (IntersectionObserver). Теперь скрипт находит точный скролл-контейнер
  *    по цепочке родителей от последнего комментария, докручивает до самого дна (scrollHeight) и делает
  *    лёгкое движение вверх-вниз (wiggle) с генерацией событий scroll и wheel, чтобы гарантированно
  *    срабатывал триггер догрузки последних 30–50 комментариев.
  *
  * 3. ПЛАВАЮЩИЙ ЖИВОЙ СЧЁТЧИК В УГЛУ ЭКРАНА + ЦИФРЫ НА КНОПКЕ:
  *    Пока модальное окно прокручивается вниз (и верхняя кнопка [⬇] уезжает за пределы экрана), в правом
  *    нижнем углу окна висит аккуратная плашка: «⏳ v2.4 · Раскрыто комментариев: 215 (шаг 12)...»,
  *    а после завершения число скачанных комментариев («✓ 251») остаётся прямо на кнопке [⬇].
  */

(() => {
  const CONFIG = {
    version: '2.4',
    indentationStyle: 'nested-list', // 'nested-list' | 'blockquote' | 'headings'
    includeTimestamps: true,
    includeLikes: true,
    includeMetadataHeader: true,
    autoExpandReplies: true,
    switchFilterToAll: true,
    minDelayMs: 360,
    maxDelayMs: 580,
    maxExpansionRounds: 180
  };

  const PATTERNS = {
    modalTitleHeader: /^(публикация|post by|.*'s post)/i,
    insightsLink: /^(смотреть статистику|see insights|view insights)/i,
    filterTrigger: /^(самые актуальные|все комментарии|сначала новые|most relevant|all comments|newest)/i,
    allCommentsOption: /(все комментарии|all comments)/i,
    // Полный набор русских (с «е» и «ё») и английских кнопок раскрытия веток и догрузки комментариев:
    expandRepliesOrComments: /((посмотреть|смотреть|показать)\s+(все\s+|ещ[её]\s+|другие\s+|предыдущие\s+|следующие\s+)?(\d+\s+)?(ответ|коммент)|ещ[её]\s+(\d+\s+)?(ответ|коммент)|\b\d+\s+ответ(а|ов)?\b|ответов:\s*\d+|(предыдущие|другие)\s+(комментарии|ответы)|(view|see|show)\s+(more|all|previous|\d+)\s*(repl|comment)?|\b\d+\s+(more\s+)?(repl(y|ies)|comment))/i,
    excludeFromExpand: /(скрыть|свернуть|удалить|пожаловаться|редактировать|ответить|нравится|поделиться|комментировать|репост|hide|collapse|delete|report|reply|like|share)/i,
    seeMoreText: /^(ещ[её]|see more)$/i,
    replyButtonExact: /^(ответить|reply)$/i,
    likeOrReplyNoise: /^(нравится|ответить|поделиться|like|reply|share|ещ[её]|see more|\d+\s*(ч\.|мин\.|д\.|нед\.|г\.|h|m|d|w|y))$/i
  };

  const ICONS = {
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    spinner: '<svg class="fb-md-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    reposts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomDelay = () =>
    sleep(Math.floor(CONFIG.minDelayMs + Math.random() * (CONFIG.maxDelayMs - CONFIG.minDelayMs)));

  /**
   * Плавающий индикатор в правом нижнем углу экрана (чтобы вы видели цифры, даже когда модальное окно прокручено вниз)
   */
  function updateFloatingStatus(text, state = 'working') {
    let badge = document.getElementById('fb-md-floating-status');
    if (!text) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'fb-md-floating-status';
      document.body.appendChild(badge);
    }
    badge.dataset.state = state;
    const icon = state === 'done' ? ICONS.check : ICONS.spinner;
    badge.innerHTML = `${icon}<span>${text}</span>`;
  }

  function decodeRelayStoryId(b64) {
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

  function extractPostIdFromText(sourceText) {
    if (!sourceText) return null;

    const uzpfMatch = sourceText.match(/"storyID"\s*:\s*"(Uzpf[A-Za-z0-9+/=]+)"/) ||
      sourceText.match(/\b(Uzpf[A-Za-z0-9+/=]{16,120})\b/);
    if (uzpfMatch) {
      const decoded = decodeRelayStoryId(uzpfMatch[1]);
      if (decoded) return decoded;
    }

    const fbMatch = sourceText.match(/\b(ZmVlZGJhY2s6[A-Za-z0-9+/=]{8,80})\b/);
    if (fbMatch) {
      const decoded = decodeRelayStoryId(fbMatch[1]);
      if (decoded) return decoded;
    }

    const jsonId = sourceText.match(/"(?:post_id|top_level_post_id|story_fbid)"\s*:\s*"?(\d{10,25})"?/);
    if (jsonId) return jsonId[1];

    const urlMatchers = [
      /[?&]set=(?:pcb|gm)\.(\d{10,25})/i,
      /[?&]story_fbid=(\d{10,25})/i,
      /\/(?:posts|permalink|videos|reel)\/(\d{10,25})\b/i
    ];
    for (const rx of urlMatchers) {
      const m = sourceText.match(rx);
      if (m) return m[1];
    }

    return null;
  }

  async function resolvePostNumericId(postRoot) {
    const fromBridge = postRoot.getAttribute('data-fb-post-id');
    if (fromBridge && /^\d{8,25}$/.test(fromBridge)) {
      return fromBridge;
    }

    const fromLocation = extractPostIdFromText(window.location.href);
    if (fromLocation) {
      postRoot.setAttribute('data-fb-post-id', fromLocation);
      return fromLocation;
    }

    const links = Array.from(postRoot.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    for (const href of links) {
      const id = extractPostIdFromText(href);
      if (id) {
        postRoot.setAttribute('data-fb-post-id', id);
        return id;
      }
    }

    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (txt.includes('CometSinglePostDialogRoot') || txt.includes('storyID') || txt.includes('Uzpf')) {
        const id = extractPostIdFromText(txt);
        if (id) {
          postRoot.setAttribute('data-fb-post-id', id);
          return id;
        }
      }
    }

    let permalinkUrl = window.location.href;
    if (!/\/(posts|permalink|photo|videos)\b/i.test(permalinkUrl)) {
      const postLink = links.find((h) => /\/(posts|permalink)\/pfbid/i.test(h));
      if (postLink) {
        permalinkUrl = new URL(postLink, window.location.origin).href;
      }
    }

    try {
      const resp = await fetch(permalinkUrl, {
        credentials: 'include',
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      const htmlText = await resp.text();
      const id = extractPostIdFromText(htmlText);
      if (id) {
        postRoot.setAttribute('data-fb-post-id', id);
        return id;
      }
    } catch (e) {
      console.warn('[FB-MD-Exporter v2.4] Не удалось фоново загрузить permalink:', e);
    }

    return null;
  }

  function findActivePostContainer() {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
    for (const dialog of dialogs) {
      if (dialog.getBoundingClientRect().width < 420) continue;

      const hasCommentInput = dialog.querySelector('[contenteditable="true"], [role="textbox"]');
      const textSample = (dialog.innerText || '').slice(0, 600);

      if (
        hasCommentInput ||
        PATTERNS.modalTitleHeader.test(textSample) ||
        /(самые актуальные|все комментарии|комментировать как|most relevant|all comments)/i.test(textSample)
      ) {
        return { container: dialog, mode: 'modal' };
      }
    }

    const path = window.location.pathname;
    const isPermalinkPage =
      /\/(posts|permalink|videos|watch|photo)\b/i.test(path) ||
      window.location.search.includes('story_fbid=');

    if (isPermalinkPage) {
      const main = document.querySelector('div[role="main"]') || document.body;
      return { container: main, mode: 'page' };
    }

    return null;
  }

  /**
   * Находит точное место в горизонтальном ряду счётчиков сразу после кнопки репостов (↗ 103),
   * используя точные атрибуты из вашего HTML:
   * - [data-ad-rendering-role="share_button"]
   * - [data-ad-rendering-role="comment_button"]
   */
  function findStatsRowMountPoint(container) {
    const shareOrCommentMarker =
      container.querySelector('[data-ad-rendering-role="share_button"]') ||
      container.querySelector('[aria-label*="Поделиться публикацией"], [aria-label*="репоста"], [aria-label*="Share"]') ||
      container.querySelector('[data-ad-rendering-role="comment_button"]') ||
      container.querySelector('[aria-label*="Комментировать публикацию"]');

    if (shareOrCommentMarker) {
      const roleBtn = shareOrCommentMarker.closest('[role="button"]');
      const itemColumnWrapper = roleBtn ? roleBtn.parentElement : null;
      const horizontalStatsRow = itemColumnWrapper ? itemColumnWrapper.parentElement : null;

      if (itemColumnWrapper && horizontalStatsRow) {
        return {
          mode: 'after-item',
          targetItem: itemColumnWrapper,
          row: horizontalStatsRow
        };
      }
    }

    const allElements = Array.from(container.querySelectorAll('span, div[role="button"]'));
    const filterEl = allElements.find((el) => {
      const txt = (el.textContent || '').trim();
      return txt.length > 0 && txt.length <= 30 && PATTERNS.filterTrigger.test(txt);
    });

    if (filterEl) {
      const filterRow = filterEl.closest('div')?.parentElement;
      if (filterRow) {
        filterRow.style.display = 'flex';
        filterRow.style.alignItems = 'center';
        filterRow.style.justifyContent = 'space-between';
        return { mode: 'append', row: filterRow };
      }
    }

    return null;
  }

  /**
   * Находит точный прокручиваемый контейнер ленты комментариев внутри модального окна:
   * сначала поднимается по цепочке родителей от последнего комментария («Ответить»),
   * а если комментариев ещё мало — выбирает контейнер с наибольшим запасом прокрутки.
   */
  function findBestScrollableContainer(root) {
    const allButtons = Array.from(root.querySelectorAll('div[role="button"], span[role="button"]'));
    const replyButtons = allButtons.filter((b) =>
      PATTERNS.replyButtonExact.test((b.textContent || '').trim())
    );

    if (replyButtons.length > 0) {
      let curr = replyButtons[replyButtons.length - 1].parentElement;
      while (curr && curr !== document.body) {
        const style = window.getComputedStyle(curr);
        const overflowY = style.overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
          curr.scrollHeight > curr.clientHeight + 10 &&
          curr.clientHeight > 120
        ) {
          return curr;
        }
        if (curr === root) break;
        curr = curr.parentElement;
      }
    }

    const divs = Array.from(root.querySelectorAll('div'));
    let bestDiv = null;
    let maxScrollable = 0;

    for (const div of divs) {
      const style = window.getComputedStyle(div);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') {
        const diff = div.scrollHeight - div.clientHeight;
        if (diff > maxScrollable && div.clientHeight > 120) {
          maxScrollable = diff;
          bestDiv = div;
        }
      }
    }
    return bestDiv;
  }

  /**
   * Ждёт, пока в модальном окне крутится ВИДИМЫЙ индикатор подгрузки Facebook ([role="progressbar"] или [aria-busy="true"])
   */
  async function waitForFacebookSpinner(postRoot, maxWaitMs = 3200) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const spinners = Array.from(postRoot.querySelectorAll('[role="progressbar"], [aria-busy="true"]')).filter(
        (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
      );
      if (spinners.length === 0) break;
      await sleep(220);
    }
  }

  /**
   * Быстрый подсчёт уже загруженных в DOM комментариев (по кнопкам «Ответить» или блокам role="article")
   */
  function countLoadedCommentsInDom(postRoot) {
    const allButtons = Array.from(postRoot.querySelectorAll('div[role="button"], span[role="button"]'));
    const replyCount = allButtons.filter((b) =>
      PATTERNS.replyButtonExact.test((b.textContent || '').trim())
    ).length;
    if (replyCount > 0) return replyCount;

    return Array.from(postRoot.querySelectorAll('[role="article"]')).filter(
      (el) => el !== postRoot && !el.querySelector('[role="article"]')
    ).length;
  }

  /**
   * Докручивает модальное окно до самого дна (scrollHeight) без отскока вверх!
   * Если передан флаг doWiggle = true, делает имитацию движения колёсиком мыши вверх-вниз,
   * чтобы гарантированно сработал IntersectionObserver внизу списка у Facebook.
   */
  async function scrollToVeryBottom(postRoot, doWiggle = false) {
    const scrollBox = findBestScrollableContainer(postRoot);
    if (scrollBox) {
      if (doWiggle) {
        scrollBox.scrollTop = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight - 240);
        scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(140);
      }
      scrollBox.scrollTop = scrollBox.scrollHeight + 1000;
      scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
      try {
        scrollBox.dispatchEvent(new WheelEvent('wheel', { deltaY: 700, bubbles: true }));
      } catch (_) {}
    } else {
      window.scrollTo(0, document.body.scrollHeight);
    }

    await sleep(420);
    await waitForFacebookSpinner(postRoot, 3200);
  }

  async function switchCommentFilterToAll(postRoot) {
    if (!CONFIG.switchFilterToAll) return;

    const candidates = Array.from(postRoot.querySelectorAll('div[role="button"], span[role="button"], span'));
    const filterBtn = candidates.find((el) => {
      const txt = (el.textContent || '').trim();
      return txt.length > 0 && txt.length <= 32 && PATTERNS.filterTrigger.test(txt);
    });

    if (!filterBtn) return;
    if (PATTERNS.allCommentsOption.test((filterBtn.textContent || '').trim())) {
      return;
    }

    const clickableFilter = filterBtn.closest('[role="button"]') || filterBtn;
    clickableFilter.click();
    await sleep(650);

    const menuItems = Array.from(
      document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], div[role="button"]')
    );
    const allCommentsItem = menuItems.find((el) => {
      const txt = (el.textContent || '').trim();
      return PATTERNS.allCommentsOption.test(txt) && txt.length < 120;
    });

    if (allCommentsItem) {
      allCommentsItem.click();
      await sleep(1300);
      await waitForFacebookSpinner(postRoot, 3500);
    }
  }

  /**
   * Полное многопроходное раскрытие всех 250+ комментариев и вложенных веток до самого низа:
   * - НЕ блокирует повторный клик по кнопкам пагинации, которые React переиспользует для следующей пачки;
   * - Кликает кнопки снизу вверх, удерживая скролл у дна модального окна;
   * - Делает до 6 контрольных прокруток с «докрутом» (wiggle) в самом низу.
   */
  async function expandAllHiddenThreads(postRoot, onProgress) {
    if (!CONFIG.autoExpandReplies) return;

    // Вместо WeakSet храним статистику по каждому DOM-узлу: если после клика выросло число комментариев
    // или изменился текст кнопки, мы продолжаем кликать по ней в следующих раундах!
    const buttonClickStats = new WeakMap();
    let idleRoundsAtBottom = 0;
    let lastKnownCount = 0;

    for (let round = 1; round <= CONFIG.maxExpansionRounds; round++) {
      await scrollToVeryBottom(postRoot, idleRoundsAtBottom > 0);

      const currentCount = countLoadedCommentsInDom(postRoot);
      onProgress(currentCount, round);

      const buttons = Array.from(postRoot.querySelectorAll('div[role="button"], span[role="button"]'));
      const expandButtons = buttons.filter((btn) => {
        if (btn.closest('.fb-md-export-toolbar')) return false;
        if (btn.closest('a[href]')) return false;

        const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 95) return false;
        if (PATTERNS.filterTrigger.test(txt) || PATTERNS.seeMoreText.test(txt)) return false;
        if (PATTERNS.excludeFromExpand.test(txt)) return false;
        if (!PATTERNS.expandRepliesOrComments.test(txt)) return false;

        const prev = buttonClickStats.get(btn);
        if (prev) {
          // Если текст кнопки изменился или общее число комментариев выросло с момента прошлого клика — сбрасываем счётчик неудач
          if (prev.lastText !== txt || currentCount > prev.lastCount) {
            prev.stuckClicks = 0;
          }
          if (prev.stuckClicks >= 3) {
            return false;
          }
        }
        return true;
      });

      if (expandButtons.length > 0) {
        idleRoundsAtBottom = 0;
        // Обходим кнопки СНИЗУ ВВЕРХ, чтобы скролл оставался в нижней части ленты комментариев
        const bottomFirstButtons = expandButtons.slice().reverse();

        for (const btn of bottomFirstButtons) {
          if (!postRoot.contains(btn)) continue;
          const txtBefore = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          const countBefore = countLoadedCommentsInDom(postRoot);

          const prev = buttonClickStats.get(btn) || { stuckClicks: 0, lastText: txtBefore, lastCount: countBefore };
          prev.stuckClicks += 1;
          prev.lastText = txtBefore;
          prev.lastCount = countBefore;
          buttonClickStats.set(btn, prev);

          btn.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          await sleep(60);
          btn.click();
          await randomDelay();
          await waitForFacebookSpinner(postRoot, 2500);

          const countAfter = countLoadedCommentsInDom(postRoot);
          if (countAfter > countBefore) {
            prev.stuckClicks = 0;
          }
          onProgress(countAfter, round);
        }

        lastKnownCount = countLoadedCommentsInDom(postRoot);
        continue;
      }

      if (currentCount > lastKnownCount) {
        lastKnownCount = currentCount;
        idleRoundsAtBottom = 0;
        await sleep(600);
        continue;
      }

      // Делаем 6 контрольных прокруток с wiggle в самый низ, чтобы гарантированно догрузить хвост из 30+ комментариев
      idleRoundsAtBottom += 1;
      console.log(`[FB-MD-Exporter v2.4] Проверка дна ленты (${idleRoundsAtBottom}/6), загружено комментариев: ${currentCount}`);
      if (idleRoundsAtBottom >= 6) {
        break;
      }
      await sleep(850);
    }

    // В конце разворачиваем все длинные комментарии с кнопкой «Ещё» / «Еще» / «See more»
    const allButtons = Array.from(postRoot.querySelectorAll('div[role="button"], span[role="button"]'));
    const seeMoreButtons = allButtons.filter((btn) =>
      PATTERNS.seeMoreText.test((btn.textContent || '').trim())
    );

    for (const btn of seeMoreButtons) {
      btn.click();
      await sleep(100);
    }
  }

  function extractPostAndComments(postRoot, resolvedPostId) {
    let postAuthor = '';
    const dialogHeading = postRoot.querySelector('h2, h3, [role="heading"]');
    if (dialogHeading) {
      const rawTitle = (dialogHeading.textContent || '').trim();
      postAuthor = rawTitle.replace(/^публикация\s+/i, '').replace(/'s post$/i, '').trim();
    }
    if (!postAuthor && document.title) {
      const titleParts = document.title.split(' - ');
      if (titleParts.length > 1) {
        postAuthor = titleParts[0].replace(/^\(\d+\)\s*/, '').trim();
      }
    }
    if (!postAuthor) {
      postAuthor = 'Автор поста';
    }

    let commentContainers = Array.from(postRoot.querySelectorAll('[role="article"]')).filter(
      (el) => el !== postRoot && !el.querySelector('[role="article"]')
    );

    if (commentContainers.length === 0) {
      const allButtons = Array.from(postRoot.querySelectorAll('div[role="button"], span[role="button"]'));
      const replyButtons = allButtons.filter((el) =>
        PATTERNS.replyButtonExact.test((el.textContent || '').trim())
      );

      const discoveredNodes = [];
      const seenSet = new Set();

      for (const replyBtn of replyButtons) {
        let curr = replyBtn.parentElement;
        let bestCard = null;
        for (let step = 0; step < 8 && curr && curr !== postRoot; step++) {
          const replyCountInside = Array.from(
            curr.querySelectorAll('div[role="button"], span[role="button"]')
          ).filter((b) => PATTERNS.replyButtonExact.test((b.textContent || '').trim())).length;

          if (replyCountInside === 1) {
            bestCard = curr;
          } else if (replyCountInside > 1) {
            break;
          }
          curr = curr.parentElement;
        }

        if (bestCard && !seenSet.has(bestCard)) {
          seenSet.add(bestCard);
          discoveredNodes.push(bestCard);
        }
      }
      commentContainers = discoveredNodes;
    }

    const firstCommentNode = commentContainers[0] || null;
    const allDirAuto = Array.from(postRoot.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
    const postTextCandidates = [];

    for (const el of allDirAuto) {
      if (el.closest('.fb-md-export-toolbar')) continue;
      if (commentContainers.some((c) => c.contains(el))) continue;
      if (
        firstCommentNode &&
        Boolean(firstCommentNode.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      ) {
        continue;
      }
      if (el.parentElement && el.parentElement.closest('[dir="auto"]')) continue;

      const txt = (el.innerText || '').trim();
      if (
        txt.length > 25 &&
        !PATTERNS.modalTitleHeader.test(txt) &&
        !/^(смотреть статистику|самые актуальные|все комментарии|нравится|комментировать)$/i.test(txt)
      ) {
        postTextCandidates.push(txt);
      }
    }

    let postText = Array.from(new Set(postTextCandidates)).join('\n\n').trim();
    if (!postText && document.title && document.title.includes(' - ')) {
      postText = document.title.split(' - ').slice(1).join(' - ').trim();
    }

    const leftPositions = commentContainers
      .map((node) => {
        const avatarOrBubble = node.querySelector('a[role="link"], div[dir="auto"]') || node;
        return avatarOrBubble.getBoundingClientRect().left;
      })
      .filter((x) => x > 0);

    const minLeft = leftPositions.length > 0 ? Math.min(...leftPositions) : 0;
    const parsedComments = [];

    for (const node of commentContainers) {
      const measureEl = node.querySelector('a[role="link"], div[dir="auto"]') || node;
      const rectLeft = measureEl.getBoundingClientRect().left;
      const rawDepth = minLeft > 0 ? Math.max(0, Math.round((rectLeft - minLeft) / 34)) : 0;
      const ariaLabel = node.getAttribute('aria-label') || '';
      const isReplyByAria = /(ответ|reply)/i.test(ariaLabel);
      const depth = Math.min(5, Math.max(rawDepth, isReplyByAria && rawDepth === 0 ? 1 : rawDepth));

      const links = Array.from(node.querySelectorAll('a[role="link"], a[href]'));
      let author = '';
      for (const link of links) {
        const linkText = (link.textContent || '').trim();
        if (
          linkText.length >= 2 &&
          linkText.length <= 65 &&
          !/^(\d+\s*(ч|мин|д|нед|г|h|m|d|w|y)|нравится|ответить|поделиться)/i.test(linkText)
        ) {
          author = linkText;
          break;
        }
      }
      if (!author) author = 'Пользователь';

      let timestamp = '';
      for (const link of links) {
        const t = (link.textContent || '').trim();
        if (/^\d+\s*(ч\.?|мин\.?|д\.?|нед\.?|г\.?|сек\.?|h|m|d|w|y)$/i.test(t)) {
          timestamp = t;
          break;
        }
      }

      const textElements = Array.from(node.querySelectorAll('div[dir="auto"], span[dir="auto"]')).filter(
        (el) => {
          const parentLink = el.closest('a[role="link"]');
          if (parentLink && (parentLink.textContent || '').trim() === author) return false;
          const ancestorDir = el.parentElement ? el.parentElement.closest('[dir="auto"]') : null;
          if (ancestorDir && node.contains(ancestorDir)) return false;
          return true;
        }
      );

      const paragraphs = [];
      for (const el of textElements) {
        const pText = (el.innerText || '').trim();
        if (
          !pText ||
          pText === author ||
          pText === timestamp ||
          PATTERNS.likeOrReplyNoise.test(pText) ||
          PATTERNS.expandRepliesOrComments.test(pText)
        ) {
          continue;
        }
        if (!paragraphs.includes(pText)) {
          paragraphs.push(pText);
        }
      }

      const commentText = paragraphs.join('\n').trim();
      if (!commentText) continue;

      let likes = 0;
      const ariaReactions = Array.from(node.querySelectorAll('[aria-label*="реакц"], [aria-label*="reaction"]'));
      for (const r of ariaReactions) {
        const m = (r.getAttribute('aria-label') || r.textContent || '').match(/(\d+)/);
        if (m) {
          likes = parseInt(m[1], 10);
          break;
        }
      }
      if (!likes) {
        const spans = Array.from(node.querySelectorAll('span')).map((s) => (s.textContent || '').trim());
        const numericSpan = spans.find((s) => /^\d{1,4}$/.test(s));
        if (numericSpan) likes = parseInt(numericSpan, 10);
      }

      parsedComments.push({
        author,
        timestamp,
        text: commentText,
        likes,
        depth
      });
    }

    return {
      postAuthor,
      postId: resolvedPostId || null,
      repostsUrl: resolvedPostId ? `https://www.facebook.com/shares/view?id=${resolvedPostId}` : null,
      postUrl: window.location.href,
      exportedAt: new Date().toLocaleString('ru-RU'),
      postText,
      comments: parsedComments
    };
  }

  function buildMarkdownDocument(data) {
    const lines = [];

    if (CONFIG.includeMetadataHeader) {
      lines.push('---');
      lines.push(`author: "${data.postAuthor.replace(/"/g, '\\"')}"`);
      lines.push(`source_url: "${data.postUrl}"`);
      if (data.postId) {
        lines.push(`post_id: "${data.postId}"`);
        lines.push(`reposts_url: "${data.repostsUrl}"`);
      }
      lines.push(`exported_at: "${data.exportedAt}"`);
      lines.push(`comments_count: ${data.comments.length}`);
      lines.push('---', '');
    }

    lines.push(`# Пост: ${data.postAuthor}`);
    lines.push(`**Источник:** ${data.postUrl} · **Экспортировано:** ${data.exportedAt}`);
    if (data.repostsUrl) {
      lines.push(`**Лента репостов (ID ${data.postId}):** ${data.repostsUrl}`);
    }
    lines.push('');
    if (data.postText) {
      lines.push(data.postText, '');
    }

    lines.push('---', '', `## Комментарии (${data.comments.length})`, '');

    for (const c of data.comments) {
      const metaParts = [];
      if (CONFIG.includeTimestamps && c.timestamp) metaParts.push(c.timestamp);
      if (CONFIG.includeLikes && c.likes > 0) metaParts.push(`👍 ${c.likes}`);
      const metaSuffix = metaParts.length > 0 ? ` · *${metaParts.join(' · ')}*` : '';

      if (CONFIG.indentationStyle === 'nested-list') {
        const indent = '  '.repeat(c.depth);
        const formattedText = c.text
          .split('\n')
          .map((line, i) => (i === 0 ? line : `${indent}  ${line}`))
          .join('\n');
        lines.push(`${indent}- **${c.author}**${metaSuffix}: ${formattedText}`);
      } else if (CONFIG.indentationStyle === 'blockquote') {
        const prefix = '> '.repeat(c.depth + 1);
        lines.push(`${prefix}**${c.author}**${metaSuffix}`);
        c.text.split('\n').forEach((line) => lines.push(`${prefix}${line}`));
        lines.push('>');
      } else {
        const level = Math.min(6, c.depth + 3);
        const depthPrefix = c.depth > 0 ? `↳ Уровень ${c.depth} · ` : '';
        lines.push(`${'#'.repeat(level)} ${depthPrefix}${c.author}${metaSuffix}`, '', c.text, '');
      }
    }

    return lines.join('\n') + '\n';
  }

  function triggerMarkdownDownload(markdownText, authorName) {
    const safeSlug = authorName
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'facebook-post';

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `fb-${safeSlug}-${dateStr}.md`;

    const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function mountSinglePostExporter() {
    const activeTarget = findActivePostContainer();
    if (!activeTarget) {
      document.querySelectorAll('.fb-md-export-toolbar').forEach((el) => el.remove());
      return;
    }

    const { container } = activeTarget;
    if (container.querySelector('.fb-md-export-toolbar')) {
      return;
    }

    const mountPoint = findStatsRowMountPoint(container);
    if (!mountPoint) {
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'fb-md-export-toolbar';

    // 1. Маленькая аккуратная иконка скачивания [⬇]
    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'fb-md-icon-btn';
    downloadBtn.title = 'FB MD Exporter v2.4 — Скачать пост и все комментарии (.MD)';
    downloadBtn.setAttribute('aria-label', 'Скачать в Markdown');
    downloadBtn.innerHTML = ICONS.download;

    // 2. Маленькая аккуратная иконка открытия всех репостов [🔁]
    const repostsBtn = document.createElement('button');
    repostsBtn.type = 'button';
    repostsBtn.className = 'fb-md-reposts-btn';
    repostsBtn.title = 'Открыть ленту всех репостов этого поста';
    repostsBtn.setAttribute('aria-label', 'Посмотреть репосты поста');
    repostsBtn.innerHTML = ICONS.reposts;

    resolvePostNumericId(container).then((foundId) => {
      if (foundId) {
        repostsBtn.title = `Открыть все репосты поста (ID: ${foundId})`;
      }
    });

    repostsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      repostsBtn.innerHTML = ICONS.spinner;
      const postId = await resolvePostNumericId(container);
      repostsBtn.innerHTML = ICONS.reposts;

      if (postId) {
        const sharesUrl = `https://www.facebook.com/shares/view?id=${postId}`;
        const a = document.createElement('a');
        a.href = sharesUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        repostsBtn.title = 'Не удалось определить числовой ID поста';
      }
    });

    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (downloadBtn.dataset.state === 'working') return;

      try {
        console.log('[FB-MD-Exporter v2.4] Старт полного раскрытия и экспорта комментариев...');
        downloadBtn.dataset.state = 'working';
        downloadBtn.innerHTML = `${ICONS.spinner}<span>0</span>`;
        downloadBtn.title = 'Переключение фильтра на «Все комментарии»...';
        updateFloatingStatus('v2.4 · Включаем «Все комментарии»...', 'working');

        await switchCommentFilterToAll(container);

        await expandAllHiddenThreads(container, (loadedCount, round) => {
          downloadBtn.innerHTML = `${ICONS.spinner}<span>${loadedCount}</span>`;
          downloadBtn.title = `Подгрузка и раскрытие веток (найдено комментариев: ${loadedCount})...`;
          updateFloatingStatus(
            `v2.4 · Раскрыто комментариев: ${loadedCount} (шаг ${round || 1})...`,
            'working'
          );
        });

        const postId = await resolvePostNumericId(container);
        const extracted = extractPostAndComments(container, postId);
        const md = buildMarkdownDocument(extracted);
        triggerMarkdownDownload(md, extracted.postAuthor);

        console.log(`[FB-MD-Exporter v2.4] Готово! Экспортировано комментариев: ${extracted.comments.length}`);
        downloadBtn.dataset.state = 'done';
        // Оставляем итоговое число скачанных комментариев на кнопке постоянно, чтобы вы видели его, когда вернётесь наверх!
        downloadBtn.innerHTML = `${ICONS.check}<span>${extracted.comments.length}</span>`;
        downloadBtn.title = `Скачано комментариев: ${extracted.comments.length} (нажмите, чтобы скачать снова)`;
        updateFloatingStatus(`v2.4 · Готово! Скачано комментариев: ${extracted.comments.length}`, 'done');
        setTimeout(() => {
          updateFloatingStatus(null);
        }, 6000);
      } catch (err) {
        console.error('[FB-MD-Exporter v2.4]', err);
        downloadBtn.dataset.state = '';
        downloadBtn.innerHTML = ICONS.download;
        downloadBtn.title = 'Ошибка при экспорте (подробности в консоли)';
        updateFloatingStatus(null);
      }
    });

    toolbar.appendChild(downloadBtn);
    toolbar.appendChild(repostsBtn);

    if (mountPoint.mode === 'after-item' && mountPoint.targetItem) {
      mountPoint.targetItem.insertAdjacentElement('afterend', toolbar);
    } else if (mountPoint.row) {
      mountPoint.row.appendChild(toolbar);
    }
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(mountSinglePostExporter, 220);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  mountSinglePostExporter();
})();
