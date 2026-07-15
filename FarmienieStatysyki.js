
// ==UserScript==
// @name         TW - Filtry farmy od zera V1.27 poprawiony Ajax
// @version      1.27
// @match        https://*.plemiona.pl/game.php*screen=am_farm*
// @match        https://*.plemiona.pl/game.php*screen=place*
// @noframes
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'tw_farm_filters_v3';

    const VISIBILITY_KEYS = {
        mini: 'tw_mini_filters_visible',
        original: 'tw_original_filters_visible',
        templates: 'tw_templates_visible'
    };

    const SHOW_RESOURCES_KEY = 'tw_show_spied_resources';
    const REPORT_RESOURCE_CACHE_KEY = 'tw_report_resource_cache_v1';
    const REPORT_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
    const LIGHT_CARRY = 80;

    const AUTO_RETURN_KEY = 'tw_mini_auto_return';
    const AUTO_RETURN_PHASE_KEY = 'tw_mini_auto_return_phase';

    const FILTER_IDS = [
        'twHideWall1',
        'twHideWall1Plus',
        'twOnlyKnownWall',
        'twReportMode',
        'twMinDistance',
        'twMaxDistance',
        'twOnlyWall',
        'twMinResources',
        'twMaxResources',
        'twListLimit'
    ];

    let villageCache = null;
    let scheduledFrame = null;
    let inputTimer = null;
    let resourceRefreshTimer = null;
    let resourceReadRun = 0;
    let resourceReadInProgress = false;
    let reportCacheLoaded = false;
    let autoAttackRunning = false;

    const reservedAutoUnits = {};
    const autoAttackQueue = [];
    const loadedPageUrls = new Set();
    const discoveredPageUrls = new Set();
    const reportResourceCache = new Map();

    function loadSettings() {
        try {
            return normalizeSettings(
                JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
            );
        } catch (error) {
            return normalizeSettings({});
        }
    }

    function normalizeSettings(settings) {
        settings = settings || {};

        settings.sumClickMode = ['ajax', 'place'].includes(
            settings.sumClickMode
        )
            ? settings.sumClickMode
            : 'ajax';

        settings.ajaxDelay = Math.max(
            0,
            parseInt(settings.ajaxDelay, 10) || 100
        );

        settings.ajaxPollDelay = Math.max(
            100,
            parseInt(settings.ajaxPollDelay, 10) || 500
        );

        settings.ajaxSentDelay = Math.max(
            0,
            parseInt(settings.ajaxSentDelay, 10) || 500
        );

        settings.ajaxTimeout = Math.max(
            5000,
            parseInt(settings.ajaxTimeout, 10) || 40000
        );

        settings.ajaxFetchDelay = Math.max(
            0,
            parseInt(settings.ajaxFetchDelay, 10) || 120
        );

        return settings;
    }

    function readSettings() {
        const minDistanceValue =
            document.getElementById('twMinDistance').value.trim();

        const maxDistanceValue =
            document.getElementById('twMaxDistance').value.trim();

        const onlyWallValue =
            document.getElementById('twOnlyWall').value.trim();

        const minResourcesValue =
            document.getElementById('twMinResources').value.trim();

        const listLimitValue =
            document.getElementById('twListLimit').value.trim();

        const ajaxDelayValue =
            document.getElementById('twAjaxDelay').value.trim();

        const ajaxPollDelayValue =
            document.getElementById('twAjaxPollDelay').value.trim();

        const ajaxSentDelayValue =
            document.getElementById('twAjaxSentDelay').value.trim();

        const ajaxTimeoutValue =
            document.getElementById('twAjaxTimeout').value.trim();

        const ajaxFetchDelayValue =
            document.getElementById('twAjaxFetchDelay').value.trim();

        const reportMode =
            document.getElementById('twReportMode').value;

        return {
            hideWall1:
                document.getElementById('twHideWall1').checked,

            hideWall1Plus:
                document.getElementById('twHideWall1Plus').checked,

            onlyKnownWall:
                document.getElementById('twOnlyKnownWall').checked,

            onlyWithReport:
                reportMode === 'with',

            onlyWithoutReport:
                reportMode === 'without',

            reportMode,

            minDistance:
                minDistanceValue,

            maxDistance:
                maxDistanceValue,

            onlyWall:
                onlyWallValue,

            minResources:
                minResourcesValue,

            maxResources:
                document.getElementById('twMaxResources').checked,

            showResources:
                document.getElementById('twShowResources').checked,

            listLimit:
                listLimitValue,

            sumClickMode:
                document.getElementById('twSumClickMode').value,

            ajaxDelay:
                ajaxDelayValue,

            ajaxPollDelay:
                ajaxPollDelayValue,

            ajaxSentDelay:
                ajaxSentDelayValue,

            ajaxTimeout:
                ajaxTimeoutValue,

            ajaxFetchDelay:
                ajaxFetchDelayValue
        };
    }

    function saveSettings(settings) {
        settings = normalizeSettings(settings);

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                hideWall1: settings.hideWall1,
                hideWall1Plus: settings.hideWall1Plus,
                onlyKnownWall: settings.onlyKnownWall,
                onlyWithReport: settings.onlyWithReport,
                onlyWithoutReport: settings.onlyWithoutReport,
                reportMode: settings.reportMode,
                minDistance: settings.minDistance,
                maxDistance: settings.maxDistance,
                onlyWall: settings.onlyWall,
                minResources: settings.minResources,
                maxResources: settings.maxResources,
                listLimit: settings.listLimit,
                sumClickMode: settings.sumClickMode,
                ajaxDelay: settings.ajaxDelay,
                ajaxPollDelay: settings.ajaxPollDelay,
                ajaxSentDelay: settings.ajaxSentDelay,
                ajaxTimeout: settings.ajaxTimeout,
                ajaxFetchDelay: settings.ajaxFetchDelay
            })
        );
    }

    function getVillageRows() {
        return Array.from(
            document.querySelectorAll('#plunder_list tr')
        ).filter(row => {
            return row.id && row.id.startsWith('village_');
        });
    }

    function getRelatedRows(row) {
        const rows = [row];
        let next = row.nextElementSibling;

        while (
            next &&
            !(next.id && next.id.startsWith('village_'))
        ) {
            rows.push(next);
            next = next.nextElementSibling;
        }

        return rows;
    }

    function getWall(row) {
        const cells = row.querySelectorAll('td');

        if (cells.length < 7) {
            return null;
        }

        const text = cells[6].innerText.trim();

        if (text === '?') {
            return null;
        }

        const wall = parseInt(text, 10);

        return Number.isNaN(wall)
            ? null
            : wall;
    }

    function setWall1BButtonState(row, disable) {
        const relatedRows = getRelatedRows(row);

        const buttons = relatedRows.flatMap(relatedRow => {
            return Array.from(
                relatedRow.querySelectorAll(
                    'a.farm_icon_b, ' +
                    'button.farm_icon_b, ' +
                    'input.farm_icon_b'
                )
            );
        });

        buttons.forEach(button => {
            if (disable) {
                if (button.dataset.twMiniWallBlock === '1') {
                    return;
                }

                button.dataset.twMiniWallBlock = '1';
                button.dataset.twMiniOriginalTitle =
                    button.title || '';

                button.dataset.twMiniOriginalOpacity =
                    button.style.opacity || '';

                button.dataset.twMiniOriginalPointerEvents =
                    button.style.pointerEvents || '';

                button.dataset.twMiniOriginalCursor =
                    button.style.cursor || '';

                button.classList.add('twMiniWallBlock');

                button.style.opacity = '0.4';
                button.style.pointerEvents = 'none';
                button.style.cursor = 'not-allowed';

                button.title =
                    'Mur 1 wymaga co najmniej 4 LK - przycisk B zablokowany';
            } else {
                if (button.dataset.twMiniWallBlock !== '1') {
                    return;
                }

                button.dataset.twMiniWallBlock = '';

                if (
                    button.dataset.twMiniOriginalTitle !== undefined
                ) {
                    button.title =
                        button.dataset.twMiniOriginalTitle;
                }

                button.style.opacity =
                    button.dataset.twMiniOriginalOpacity || '';

                button.style.pointerEvents =
                    button.dataset.twMiniOriginalPointerEvents || '';

                button.style.cursor =
                    button.dataset.twMiniOriginalCursor || '';

                button.classList.remove('twMiniWallBlock');

                delete button.dataset.twMiniOriginalTitle;
                delete button.dataset.twMiniOriginalOpacity;
                delete button.dataset.twMiniOriginalPointerEvents;
                delete button.dataset.twMiniOriginalCursor;
            }
        });
    }

    function updateWall1BButtons() {
        getVillageRows().forEach(row => {
            const wall = getWall(row);

            setWall1BButtonState(
                row,
                wall === 1
            );
        });
    }

    function getPlaceWallLevel() {
        const labelSelectors = [
            'td',
            'th',
            'span',
            'b',
            'strong',
            'label'
        ];

        for (const selector of labelSelectors) {
            const labels = Array.from(
                document.querySelectorAll(selector)
            );

            for (const label of labels) {
                const text =
                    (label.textContent || '').trim();

                if (!text) {
                    continue;
                }

                const normalized = text
                    .replace(/\s+/g, ' ')
                    .toLowerCase();

                if (
                    !/^(mur:?|mur poziom|poziom muru|muru)$/i.test(
                        normalized
                    )
                ) {
                    continue;
                }

                const next = label.nextElementSibling;

                if (next) {
                    const value = parseInt(
                        next.textContent.trim(),
                        10
                    );

                    if (!Number.isNaN(value)) {
                        return value;
                    }
                }

                const row = label.closest('tr');

                if (row) {
                    const cells = Array.from(
                        row.querySelectorAll('td, th')
                    );

                    for (
                        let index = 0;
                        index < cells.length - 1;
                        index++
                    ) {
                        if (cells[index] !== label) {
                            continue;
                        }

                        const value = parseInt(
                            cells[index + 1].textContent.trim(),
                            10
                        );

                        if (!Number.isNaN(value)) {
                            return value;
                        }
                    }
                }
            }
        }

        const bodyMatch = document.body.textContent.match(
            /mur\s*[:\-]?\s*(\d+)/i
        );

        return bodyMatch
            ? parseInt(bodyMatch[1], 10)
            : null;
    }

    function getDistance(row) {
        const icon = row.querySelector(
            'img[src*="rechts.webp"], img[src*="/rechts."]'
        );

        if (!icon) {
            return null;
        }

        let text = '';
        let node = icon.nextSibling;

        while (node) {
            if (
                node.nodeType === 1 &&
                node.tagName === 'BR'
            ) {
                break;
            }

            text += ' ' + (node.textContent || '');
            node = node.nextSibling;
        }

        const match = text
            .replace(',', '.')
            .match(/\d+(?:\.\d+)?/);

        if (!match) {
            return null;
        }

        const distance = parseFloat(match[0]);

        return Number.isNaN(distance)
            ? null
            : distance;
    }

    function hasReport(row) {
        const related = getRelatedRows(row).slice(1);

        return related.some(relatedRow => {
            const text =
                relatedRow.innerText.toLowerCase();

            return (
                relatedRow.className.includes('report_') ||
                text.includes('dzisiaj') ||
                text.includes('wczoraj') ||
                /\d{1,2}\.\d{1,2}\.\d{2,4}/.test(text)
            );
        });
    }

    function setRowsVisible(rows, visible) {
        const display = visible
            ? ''
            : 'none';

        rows.forEach(row => {
            if (row.style.display !== display) {
                row.style.display = display;
            }
        });
    }

    function getVillageCache() {
        if (villageCache) {
            return villageCache;
        }

        villageCache = getVillageRows().map(
            (row, index) => {
                if (
                    !row.hasAttribute(
                        'data-tw-mini-original-order'
                    )
                ) {
                    row.dataset.twMiniOriginalOrder =
                        String(index);
                }

                return {
                    rows: getRelatedRows(row),
                    wall: getWall(row),
                    distance: getDistance(row),
                    report: hasReport(row),
                    visible: null
                };
            }
        );

        return villageCache;
    }

    function sortVillageGroupsByResources(enabled) {
        const table =
            document.getElementById('plunder_list');

        const tbody =
            table && table.querySelector('tbody');

        if (!tbody) {
            return;
        }

        const groups = getVillageCache().slice();

        groups.sort((left, right) => {
            const leftRow = left.rows[0];
            const rightRow = right.rows[0];

            if (enabled) {
                const leftTotal =
                    parseInt(
                        leftRow.dataset.twMiniResourceTotal,
                        10
                    ) || 0;

                const rightTotal =
                    parseInt(
                        rightRow.dataset.twMiniResourceTotal,
                        10
                    ) || 0;

                if (rightTotal !== leftTotal) {
                    return rightTotal - leftTotal;
                }
            }

            return (
                (
                    parseInt(
                        leftRow.dataset.twMiniOriginalOrder,
                        10
                    ) || 0
                ) -
                (
                    parseInt(
                        rightRow.dataset.twMiniOriginalOrder,
                        10
                    ) || 0
                )
            );
        });

        const fragment =
            document.createDocumentFragment();

        groups.forEach(group => {
            group.rows.forEach(row => {
                fragment.appendChild(row);
            });
        });

        tbody.appendChild(fragment);
    }

    function applyFilters() {
        scheduledFrame = null;

        const settings = readSettings();

        const minDistance = settings.minDistance
            ? parseFloat(
                settings.minDistance.replace(',', '.')
            )
            : null;

        const maxDistance = settings.maxDistance
            ? parseFloat(
                settings.maxDistance.replace(',', '.')
            )
            : null;

        const onlyWall =
            settings.onlyWall !== ''
                ? parseInt(settings.onlyWall, 10)
                : null;

        const minResources = Math.max(
            0,
            parseInt(settings.minResources, 10) || 0
        );

        const listLimit = Math.max(
            0,
            parseInt(settings.listLimit, 10) || 0
        );

        saveSettings(settings);

        let visibleCount = 0;
        const filterItems = getVillageCache().slice();

        if (settings.maxResources) {
            filterItems.sort((left, right) => {
                const leftTotal =
                    parseInt(
                        left.rows[0].dataset.twMiniResourceTotal,
                        10
                    ) || 0;

                const rightTotal =
                    parseInt(
                        right.rows[0].dataset.twMiniResourceTotal,
                        10
                    ) || 0;

                return rightTotal - leftTotal;
            });
        }

        filterItems.forEach(item => {
            const resourceTotal = parseInt(
                item.rows[0].dataset.twMiniResourceTotal,
                10
            );

            const matchesFilters = !(
                (
                    onlyWall !== null &&
                    item.wall !== onlyWall
                ) ||
                (
                    settings.hideWall1Plus &&
                    item.wall !== null &&
                    item.wall >= 1
                ) ||
                (
                    settings.hideWall1 &&
                    item.wall === 1
                ) ||
                (
                    settings.onlyKnownWall &&
                    item.wall === null
                ) ||
                (
                    settings.onlyWithReport &&
                    !item.report
                ) ||
                (
                    settings.onlyWithoutReport &&
                    item.report
                ) ||
                (
                    minDistance !== null &&
                    item.distance !== null &&
                    item.distance < minDistance
                ) ||
                (
                    maxDistance !== null &&
                    item.distance !== null &&
                    item.distance > maxDistance
                ) ||
                (
                    settings.showResources &&
                    minResources > 0 &&
                    !Number.isNaN(resourceTotal) &&
                    resourceTotal < minResources
                )
            );

            const visible =
                matchesFilters &&
                (
                    listLimit === 0 ||
                    visibleCount < listLimit
                );

            if (visible) {
                visibleCount++;
            }

            if (item.visible === visible) {
                return;
            }

            setRowsVisible(item.rows, visible);
            item.visible = visible;
        });

        sortVillageGroupsByResources(
            settings.maxResources
        );

        updateWall1BButtons();
    }

    function scheduleFilters() {
        if (scheduledFrame !== null) {
            cancelAnimationFrame(scheduledFrame);
        }

        scheduledFrame =
            requestAnimationFrame(applyFilters);
    }

    function scheduleNumberFilters() {
        clearTimeout(inputTimer);

        inputTimer = setTimeout(
            scheduleFilters,
            120
        );
    }

    function scheduleResourceRefresh() {
        clearTimeout(resourceRefreshTimer);

        resourceRefreshTimer = setTimeout(() => {
            const checkbox =
                document.getElementById('twShowResources');

            if (checkbox && checkbox.checked) {
                readAndShowSpiedResources();
            }
        }, 300);
    }

    function updateToggleButton(
        buttonId,
        visible,
        label
    ) {
        const button =
            document.getElementById(buttonId);

        if (!button) {
            return;
        }

        button.textContent =
            (
                visible
                    ? '▲ Ukryj: '
                    : '▼ Pokaż: '
            ) + label;

        button.setAttribute(
            'aria-expanded',
            String(visible)
        );
    }

    function setMiniFiltersVisible(visible) {
        const panel =
            document.getElementById('twFarmFilterPanel');

        if (panel) {
            panel.style.display =
                visible
                    ? 'grid'
                    : 'none';
        }

        updateToggleButton(
            'twToggleMiniFilters',
            visible,
            'panel MiniAF'
        );

        localStorage.setItem(
            VISIBILITY_KEYS.mini,
            visible
                ? '1'
                : '0'
        );
    }

    function setOriginalFiltersVisible(visible) {
        const panel =
            document.getElementById('plunder_list_filters');

        if (panel) {
            panel.style.display =
                visible
                    ? 'inline-block'
                    : 'none';
        }

        updateToggleButton(
            'twToggleOriginalFilters',
            visible,
            'filtry oryginalne'
        );

        localStorage.setItem(
            VISIBILITY_KEYS.original,
            visible
                ? '1'
                : '0'
        );
    }

    function getTemplatesPanel() {
        const editor =
            document.getElementById('fa_edit');

        if (editor) {
            return editor;
        }

        const heading = Array.from(
            document.querySelectorAll(
                '#content_value h4'
            )
        ).find(element => {
            return element.textContent.trim() === 'Szablony';
        });

        return heading
            ? heading.parentElement
            : null;
    }

    function setTemplatesVisible(visible) {
        const panel = getTemplatesPanel();

        if (panel) {
            panel.style.display =
                visible
                    ? 'block'
                    : 'none';
        }

        updateToggleButton(
            'twToggleTemplates',
            visible,
            'szablony'
        );

        localStorage.setItem(
            VISIBILITY_KEYS.templates,
            visible
                ? '1'
                : '0'
        );
    }

    function setOptionsVisible(visible) {
        const modal =
            document.getElementById('twOptionsModal');

        if (!modal) {
            return;
        }

        modal.style.display =
            visible
                ? 'flex'
                : 'none';

        document.body.style.overflow =
            visible
                ? 'hidden'
                : '';
    }

    function parseResourceNumber(text) {
        const digits = String(text || '')
            .replace(/[^\d]/g, '');

        return digits
            ? parseInt(digits, 10)
            : 0;
    }

    function getNumberAfterIcon(
        area,
        classNames
    ) {
        const icon = classNames
            .map(name => {
                return area.querySelector(
                    '.icon.' + name
                );
            })
            .find(Boolean);

        if (!icon) {
            return 0;
        }

        let node = icon.nextSibling;
        let rawText = '';

        while (node) {
            if (
                node.nodeType === 1 &&
                node.classList &&
                node.classList.contains('icon')
            ) {
                break;
            }

            rawText += node.textContent || '';
            node = node.nextSibling;
        }

        return parseResourceNumber(rawText) || 0;
    }

    function parseSpiedResources(html) {
        const doc = new DOMParser()
            .parseFromString(html, 'text/html');

        const row = Array.from(
            doc.querySelectorAll('tr')
        ).find(element => {
            const header =
                element.querySelector('th');

            return (
                header &&
                header.textContent
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase()
                    .startsWith(
                        'wyszpiegowane surowce'
                    )
            );
        });

        if (!row) {
            return null;
        }

        const text = row.textContent
            .replace(/\s+/g, ' ')
            .toLowerCase();

        if (text.includes('nie ma')) {
            return {
                wood: 0,
                clay: 0,
                iron: 0
            };
        }

        return {
            wood: getNumberAfterIcon(
                row,
                ['wood']
            ),

            clay: getNumberAfterIcon(
                row,
                ['stone', 'clay']
            ),

            iron: getNumberAfterIcon(
                row,
                ['iron']
            )
        };
    }

    function getResourceValueElement(
        row,
        classNames
    ) {
        const icon = classNames
            .map(name => {
                return row.querySelector(
                    '.icon.' + name
                );
            })
            .find(Boolean);

        if (!icon) {
            return null;
        }

        let element = icon.nextElementSibling;

        while (element) {
            if (
                element.matches(
                    '.res, .warn, [data-tw-af-original-text]'
                ) ||
                /\d/.test(element.textContent || '')
            ) {
                return element;
            }

            element = element.nextElementSibling;
        }

        return null;
    }

    function formatResourceNumber(value) {
        return Math.max(
            0,
            value || 0
        ).toLocaleString('pl-PL');
    }

    function formatCompactResource(value) {
        const safeValue =
            Math.max(0, value || 0);

        if (safeValue < 1000) {
            return String(safeValue);
        }

        const compact =
            (safeValue / 1000).toFixed(2);

        const trimmed =
            compact.replace(/\.?0+$/, '');

        return trimmed.replace('.', ',') + 'k';
    }

    function ensureTotalColumnHeader() {
        const table =
            document.getElementById('plunder_list');

        if (
            !table ||
            table.querySelector(
                '.twMiniResourceTotalHeader'
            )
        ) {
            return;
        }

        const headerRow =
            table.querySelector('tr');

        if (!headerRow) {
            return;
        }

        const header =
            document.createElement('th');

        header.className =
            'twMiniResourceTotalHeader';

        header.textContent = 'Razem';

        headerRow.appendChild(header);
    }

    function ensureTotalColumnCell(row) {
        let cell = row.querySelector(
            ':scope > .twMiniResourceTotalCell'
        );

        if (cell) {
            return cell;
        }

        const resourceIcon = row.querySelector(
            '.icon.wood, ' +
            '.icon.stone, ' +
            '.icon.clay, ' +
            '.icon.iron'
        );

        const resourceCell = resourceIcon
            ? resourceIcon.closest('td')
            : null;

        cell = document.createElement('td');
        cell.className =
            'twMiniResourceTotalCell';

        cell.rowSpan = resourceCell
            ? resourceCell.rowSpan
            : 1;

        cell.vAlign = 'middle';
        cell.textContent = '—';

        row.appendChild(cell);

        return cell;
    }

    function getAutoPlaceUrl(row, total) {
        const existingLink = row.querySelector(
            'a[href*="screen=place"][href*="target="]'
        );

        const villageIdMatch = row.id.match(
            /^village_(\d+)$/
        );

        const wall = getWall(row);

        let url;

        if (existingLink) {
            url = new URL(
                existingLink.href,
                location.href
            );
        } else if (villageIdMatch) {
            url = new URL(
                '/game.php',
                location.origin
            );

            if (
                typeof game_data !== 'undefined' &&
                game_data.village &&
                game_data.village.id
            ) {
                url.searchParams.set(
                    'village',
                    game_data.village.id
                );
            }

            url.searchParams.set(
                'screen',
                'place'
            );

            url.searchParams.set(
                'target',
                villageIdMatch[1]
            );
        } else {
            return '';
        }

        const lightCount =
            wall === 1
                ? Math.max(
                    4,
                    Math.ceil(total / LIGHT_CARRY)
                )
                : Math.ceil(total / LIGHT_CARRY);

        url.searchParams.set(
            'twmini_light',
            String(lightCount)
        );

        if (wall !== null) {
            url.searchParams.set(
                'twmini_wall',
                String(wall)
            );
        }

        url.searchParams.set(
            'twmini_spy',
            '1'
        );

        url.searchParams.set(
            'twmini_total',
            String(total)
        );

        url.searchParams.set(
            'twmini_return',
            location.href
        );

        url.searchParams.set(
            'twmini_target_row',
            row.id
        );

        url.searchParams.set(
            'twmini_scroll',
            String(Math.round(window.scrollY))
        );

        return url.href;
    }

    function getAvailableHomeUnit(unit) {
        const element =
            document.querySelector(
                '#units_home [data-unit-count][id="' +
                unit +
                '"]'
            ) ||
            document.querySelector(
                '#units_home [id="' +
                unit +
                '"]'
            ) ||
            document.querySelector(
                '#units_home [data-unit="' +
                unit +
                '"]'
            );

        if (!element) {
            return Infinity;
        }

        const dataCount = parseInt(
            element.getAttribute('data-unit-count'),
            10
        );

        if (!Number.isNaN(dataCount)) {
            return dataCount;
        }

        return parseResourceNumber(
            element.textContent
        );
    }

    function getReservedAutoUnit(unit) {
        return Math.max(
            0,
            parseInt(
                reservedAutoUnits[unit],
                10
            ) || 0
        );
    }

    function reserveAutoUnits(units) {
        Object.entries(units || {})
            .forEach(([unit, amount]) => {
                amount = Math.max(
                    0,
                    parseInt(amount, 10) || 0
                );

                if (!amount) {
                    return;
                }

                reservedAutoUnits[unit] =
                    getReservedAutoUnit(unit) +
                    amount;
            });
    }

    function releaseAutoUnits(units) {
        Object.entries(units || {})
            .forEach(([unit, amount]) => {
                amount = Math.max(
                    0,
                    parseInt(amount, 10) || 0
                );

                if (!amount) {
                    return;
                }

                reservedAutoUnits[unit] =
                    Math.max(
                        0,
                        getReservedAutoUnit(unit) -
                        amount
                    );

                if (!reservedAutoUnits[unit]) {
                    delete reservedAutoUnits[unit];
                }
            });
    }

    function getAutoUnitsFromUrl(rawUrl) {
        const url = new URL(
            rawUrl,
            location.href
        );

        return {
            light:
                parseInt(
                    url.searchParams.get(
                        'twmini_light'
                    ),
                    10
                ) || 0,

            spy:
                parseInt(
                    url.searchParams.get(
                        'twmini_spy'
                    ),
                    10
                ) || 0
        };
    }

    function getReservableUnitAmount(unit) {
        const raw =
            getAvailableHomeUnit(unit);

        if (!Number.isFinite(raw)) {
            return raw;
        }

        return Math.max(
            0,
            raw - getReservedAutoUnit(unit)
        );
    }

    function attachAutoAction(
        row,
        cell,
        total
    ) {
        cell.dataset.twMiniAutoUrl =
            total > 0
                ? getAutoPlaceUrl(row, total)
                : '';

        cell.classList.toggle(
            'twMiniAutoAvailable',
            Boolean(cell.dataset.twMiniAutoUrl)
        );

        if (
            cell.dataset.twMiniAutoBound === '1'
        ) {
            return;
        }

        cell.dataset.twMiniAutoBound = '1';

        cell.addEventListener('click', () => {
            const url =
                cell.dataset.twMiniAutoUrl;

            if (!url) {
                return;
            }

            if (
                loadSettings().sumClickMode ===
                'place'
            ) {
                location.href = url;
                return;
            }

            startHiddenAutoAttack(
                url,
                cell
            );
        });
    }

    function disablePlaceAttackButtons(message) {
        const buttons = Array.from(
            document.querySelectorAll(
                'input[type="submit"], ' +
                'button[type="submit"]'
            )
        );

        const attackButtons = buttons.filter(
            button => {
                const text = String(
                    button.value ||
                    button.textContent ||
                    ''
                )
                    .trim()
                    .toLowerCase();

                return (
                    text.includes('wyślij atak') ||
                    text.includes('wyslij atak')
                );
            }
        );

        if (!attackButtons.length) {
            return;
        }

        attackButtons.forEach(button => {
            button.disabled = true;

            button.classList.add(
                'twMiniWallBlock'
            );

            if (button.tagName === 'INPUT') {
                button.dataset.twMiniOriginalValue =
                    button.value;

                button.value = message;
            } else {
                button.dataset.twMiniOriginalText =
                    button.textContent;

                button.textContent = message;
            }
        });

        let notice =
            document.getElementById(
                'twMiniWallBlockMessage'
            );

        if (!notice) {
            notice =
                document.createElement('div');

            notice.id =
                'twMiniWallBlockMessage';

            notice.style.cssText =
                'color:#a00;' +
                'font-weight:bold;' +
                'margin:10px 0;' +
                'padding:10px;' +
                'border:1px solid #a00;' +
                'background:#fee;';

            const form =
                document.querySelector(
                    'form#command_form, ' +
                    'form[action*="screen=place"]'
                ) ||
                document.querySelector('form');

            if (form && form.parentNode) {
                form.parentNode.insertBefore(
                    notice,
                    form
                );
            } else if (document.body) {
                document.body.insertBefore(
                    notice,
                    document.body.firstChild
                );
            }
        }

        notice.textContent = message;
    }

    function parseAvailableUnitCount(
        unit,
        root
    ) {
        root = root || document;

        const allEntry =
            (
                typeof root.getElementById ===
                'function'
                    ? root.getElementById(
                        'units_entry_all_' + unit
                    )
                    : root.querySelector(
                        '#units_entry_all_' + unit
                    )
            ) ||
            root.querySelector(
                'a.units-entry-all[data-unit="' +
                unit +
                '"]'
            );

        const input =
            root.querySelector(
                'input[name="' + unit + '"]'
            ) ||
            (
                typeof root.getElementById ===
                'function'
                    ? root.getElementById(
                        'unit_input_' + unit
                    )
                    : root.querySelector(
                        '#unit_input_' + unit
                    )
            );

        const sources = [
            allEntry && allEntry.textContent,
            allEntry && allEntry.getAttribute(
                'data-count'
            ),
            allEntry && allEntry.getAttribute(
                'data-all-count'
            ),
            input && input.getAttribute(
                'data-count'
            ),
            input && input.getAttribute(
                'data-all-count'
            )
        ];

        for (const source of sources) {
            if (
                !source ||
                !/\d/.test(source)
            ) {
                continue;
            }

            return parseInt(
                String(source).replace(
                    /[^\d]/g,
                    ''
                ),
                10
            );
        }

        return null;
    }

    function findSubmitControl(
        root,
        confirmation
    ) {
        if (confirmation) {
            return (
                root.querySelector(
                    '#troop_confirm_submit, ' +
                    'input[name="submit_confirm"], ' +
                    'button[name="submit_confirm"], ' +
                    'input[name="submit"], ' +
                    'button[name="submit"], ' +
                    'input[type="submit"].btn, ' +
                    'button[type="submit"].btn'
                ) ||
                Array.from(
                    root.querySelectorAll(
                        'input[type="submit"], ' +
                        'button[type="submit"]'
                    )
                ).find(button => {
                    const text = String(
                        button.value ||
                        button.textContent ||
                        button.getAttribute(
                            'data-title'
                        ) ||
                        button.title ||
                        ''
                    )
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                    return (
                        text.includes('wyślij') ||
                        text.includes('wyslij') ||
                        text.includes('atak') ||
                        text === 'ok'
                    );
                })
            );
        }

        return root.querySelector(
            '#target_attack, ' +
            'input[name="attack"], ' +
            'button[name="attack"]'
        );
    }

    function getFrameUrl(frameDocument) {
        try {
            return frameDocument.defaultView.location.href;
        } catch (error) {
            return '';
        }
    }

    function getFrameErrorText(frameDocument) {
        const candidates = Array.from(
            frameDocument.querySelectorAll(
                '.error_box, ' +
                '.error-message, ' +
                '#error, ' +
                '.server-error'
            )
        );

        return candidates
            .map(element => {
                return (
                    element.textContent || ''
                )
                    .replace(/\s+/g, ' ')
                    .trim();
            })
            .filter(Boolean)
            .join(' ');
    }

    function isFrameConfirmationPage(
        frameDocument
    ) {
        const href =
            getFrameUrl(frameDocument);

        try {
            const url = new URL(
                href,
                location.href
            );

            if (
                url.searchParams.get('try') ===
                'confirm'
            ) {
                return true;
            }
        } catch (error) {
            // Dalsze sprawdzanie przez DOM.
        }

        if (
            frameDocument.querySelector(
                '#troop_confirm_submit'
            )
        ) {
            return true;
        }

        if (
            frameDocument.querySelector(
                'input[name="submit_confirm"], ' +
                'button[name="submit_confirm"]'
            )
        ) {
            return true;
        }

        return Array.from(
            frameDocument.querySelectorAll(
                'input[type="submit"], ' +
                'button[type="submit"]'
            )
        ).some(button => {
            const text = String(
                button.value ||
                button.textContent ||
                button.title ||
                ''
            )
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

            return (
                text.includes('wyślij atak') ||
                text.includes('wyslij atak')
            );
        });
    }

    function hasAttackSuccessMessage(
        frameDocument
    ) {
        const text = Array.from(
            frameDocument.querySelectorAll(
                '.success, ' +
                '.success_box, ' +
                '.confirmation-box, ' +
                '.info_box, ' +
                '#content_value'
            )
        )
            .map(element => {
                return element.textContent || '';
            })
            .join(' ')
            .replace(/\s+/g, ' ')
            .toLowerCase();

        return (
            text.includes(
                'rozkaz został wydany'
            ) ||
            text.includes(
                'rozkaz zostal wydany'
            ) ||
            text.includes(
                'atak został wysłany'
            ) ||
            text.includes(
                'atak zostal wyslany'
            ) ||
            text.includes(
                'komenda została wysłana'
            ) ||
            text.includes(
                'komenda zostala wyslana'
            )
        );
    }

    function hasOutgoingCommandResult(
        frameDocument,
        confirmationUrl
    ) {
        if (
            isFrameConfirmationPage(
                frameDocument
            )
        ) {
            return false;
        }

        const href =
            getFrameUrl(frameDocument);

        if (
            hasAttackSuccessMessage(
                frameDocument
            )
        ) {
            return true;
        }

        try {
            const currentUrl = new URL(
                href,
                location.href
            );

            const previousUrl = new URL(
                confirmationUrl,
                location.href
            );

            const currentTry =
                currentUrl.searchParams.get('try');

            const previousTry =
                previousUrl.searchParams.get('try');

            if (
                previousTry === 'confirm' &&
                currentTry !== 'confirm' &&
                currentUrl.searchParams.get(
                    'screen'
                ) === 'place'
            ) {
                return true;
            }
        } catch (error) {
            return false;
        }

        return false;
    }

    function submitFrameControl(
        control,
        frameDocument
    ) {
        if (!control) {
            return false;
        }

        const form = control.form ||
            control.closest('form');

        try {
            if (
                form &&
                typeof form.requestSubmit ===
                'function'
            ) {
                form.requestSubmit(control);
                return true;
            }
        } catch (error) {
            console.warn(
                'requestSubmit nie zadziałał:',
                error
            );
        }

        try {
            control.click();
            return true;
        } catch (error) {
            console.warn(
                'Kliknięcie przycisku nie zadziałało:',
                error
            );
        }

        try {
            if (form) {
                form.submit();
                return true;
            }
        } catch (error) {
            console.warn(
                'submit formularza nie zadziałał:',
                error
            );
        }

        return false;
    }

    function updateUnitCount(unit, amount) {
        const element =
            document.querySelector(
                '#units_home [data-unit-count][id="' +
                unit +
                '"]'
            ) ||
            document.querySelector(
                '#units_home [id="' +
                unit +
                '"]'
            );

        if (!element) {
            return;
        }

        const current =
            parseInt(
                element.getAttribute(
                    'data-unit-count'
                ),
                10
            ) ||
            parseResourceNumber(
                element.textContent
            );

        const updated = Math.max(
            0,
            current - amount
        );

        element.setAttribute(
            'data-unit-count',
            String(updated)
        );

        element.textContent =
            String(updated);

        element.classList.toggle(
            'hidden',
            updated === 0
        );
    }

    function syncUnitsHome(
        frameDocument,
        sentUnits
    ) {
        const sourceUnits =
            frameDocument.querySelectorAll(
                '#units_home ' +
                '[data-unit-count][id]'
            );

        if (sourceUnits.length) {
            sourceUnits.forEach(source => {
                const target =
                    document.querySelector(
                        '#units_home ' +
                        '[data-unit-count][id="' +
                        source.id +
                        '"]'
                    ) ||
                    document.querySelector(
                        '#units_home [id="' +
                        source.id +
                        '"]'
                    );

                if (!target) {
                    return;
                }

                const count =
                    parseInt(
                        source.getAttribute(
                            'data-unit-count'
                        ),
                        10
                    ) || 0;

                target.setAttribute(
                    'data-unit-count',
                    String(count)
                );

                target.textContent =
                    String(count);

                target.classList.toggle(
                    'hidden',
                    count === 0
                );
            });

            return;
        }

        Object.entries(sentUnits)
            .forEach(([unit, amount]) => {
                updateUnitCount(
                    unit,
                    amount
                );
            });
    }

    function updateAutoQueueLabels() {
        autoAttackQueue.forEach(
            (item, index) => {
                item.totalCell.textContent =
                    'Kolejka ' + (index + 1);

                item.totalCell.classList.add(
                    'twMiniAutoQueued'
                );
            }
        );
    }

    function runNextAutoAttack() {
        if (
            autoAttackRunning ||
            !autoAttackQueue.length
        ) {
            return;
        }

        const next =
            autoAttackQueue.shift();

        next.totalCell.classList.remove(
            'twMiniAutoQueued'
        );

        next.totalCell.dataset.twMiniAutoQueued =
            '0';

        updateAutoQueueLabels();

        startHiddenAutoAttack(
            next.rawUrl,
            next.totalCell,
            next.reservedUnits
        );
    }

    function validateAndReserveAutoUnits(units) {
        for (
            const [unit, amount] of
            Object.entries(units || {})
        ) {
            const required = Math.max(
                0,
                parseInt(amount, 10) || 0
            );

            if (!required) {
                continue;
            }

            const available =
                getReservableUnitAmount(unit);

            if (
                Number.isFinite(available) &&
                available < required
            ) {
                alert(
                    'Brak jednostek: ' +
                    unit +
                    '. Potrzeba ' +
                    required +
                    ', dostępne po rezerwacji ' +
                    available +
                    '.'
                );

                return false;
            }
        }

        reserveAutoUnits(units);

        return true;
    }

    function startHiddenAutoAttack(
        rawUrl,
        totalCell,
        reservedUnits
    ) {
        const ajaxSettings =
            loadSettings();

        const unitsAlreadyReserved =
            Boolean(reservedUnits);

        reservedUnits =
            reservedUnits ||
            getAutoUnitsFromUrl(rawUrl);

        if (autoAttackRunning) {
            if (
                totalCell.dataset.twMiniAutoQueued ===
                '1' ||
                totalCell.classList.contains(
                    'twMiniAutoRunning'
                )
            ) {
                return;
            }

            if (
                !unitsAlreadyReserved &&
                !validateAndReserveAutoUnits(
                    reservedUnits
                )
            ) {
                return;
            }

            if (
                !totalCell.dataset
                    .twMiniAutoDisplayText
            ) {
                totalCell.dataset.twMiniAutoDisplayText =
                    totalCell.textContent;
            }

            totalCell.dataset.twMiniAutoQueued =
                '1';

            autoAttackQueue.push({
                rawUrl,
                totalCell,
                reservedUnits
            });

            updateAutoQueueLabels();
            return;
        }

        if (
            !unitsAlreadyReserved &&
            !validateAndReserveAutoUnits(
                reservedUnits
            )
        ) {
            return;
        }

        autoAttackRunning = true;

        const originalText =
            totalCell.dataset.twMiniAutoDisplayText ||
            totalCell.textContent;

        totalCell.dataset.twMiniAutoDisplayText =
            originalText;

        totalCell.textContent = 'Plac...';

        totalCell.classList.add(
            'twMiniAutoRunning'
        );

        const url = new URL(
            rawUrl,
            location.href
        );

        url.searchParams.set(
            'twmini_hidden',
            '1'
        );

        const requiredUnits =
            Object.assign({}, reservedUnits);

        const spyAmount =
            requiredUnits.spy || 0;

        const targetRow =
            totalCell.closest('tr');

        const sentUnits =
            Object.assign({}, requiredUnits);

        const iframe =
            document.createElement('iframe');

        iframe.id = 'twMiniAutoFrame';

        iframe.style.cssText = `
            position:fixed;
            left:-10000px;
            top:-10000px;
            width:1024px;
            height:768px;
            opacity:0;
            pointer-events:none;
            border:0;
        `;

        let stage = 'prepare';
        let completed = false;
        let watchdog = null;
        let timeout = null;
        let confirmClickedAt = 0;
        let confirmationUrl = '';
        let processingFrame = false;

        function finish(
            success,
            message,
            frameDocument
        ) {
            if (completed) {
                return;
            }

            completed = true;

            if (watchdog) {
                clearInterval(watchdog);
                watchdog = null;
            }

            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }

            autoAttackRunning = false;

            iframe.remove();

            totalCell.classList.remove(
                'twMiniAutoRunning'
            );

            totalCell.dataset.twMiniAutoQueued =
                '0';

            totalCell.textContent =
                originalText;

            releaseAutoUnits(
                reservedUnits
            );

            if (success) {
                if (targetRow) {
                    targetRow.dataset.twMiniSent =
                        '1';

                    setRowsVisible(
                        getRelatedRows(targetRow),
                        false
                    );
                }

                if (frameDocument) {
                    syncUnitsHome(
                        frameDocument,
                        sentUnits
                    );
                } else {
                    Object.entries(sentUnits)
                        .forEach(
                            ([unit, amount]) => {
                                updateUnitCount(
                                    unit,
                                    amount
                                );
                            }
                        );
                }

                totalCell.classList.add(
                    'twMiniAutoSent'
                );

                totalCell.title =
                    'Atak Auto wysłany';

                scheduleFilters();
            } else {
                if (targetRow) {
                    attachAutoAction(
                        targetRow,
                        totalCell,
                        parseInt(
                            targetRow.dataset
                                .twMiniResourceTotal,
                            10
                        ) || 0
                    );
                }

                alert(
                    message ||
                    'Nie udało się wysłać ataku Auto.'
                );
            }

            setTimeout(
                runNextAutoAttack,
                ajaxSettings.ajaxDelay
            );
        }

        function processFrame() {
            if (
                completed ||
                processingFrame
            ) {
                return;
            }

            let frameDocument;

            try {
                if (
                    !iframe.contentWindow ||
                    iframe.contentWindow.location.href ===
                    'about:blank'
                ) {
                    return;
                }

                frameDocument =
                    iframe.contentDocument;
            } catch (error) {
                finish(
                    false,
                    'Brak dostępu do ukrytego ekranu placu.'
                );

                return;
            }

            if (
                !frameDocument ||
                !frameDocument.documentElement
            ) {
                return;
            }

            processingFrame = true;

            try {
                const errorText =
                    getFrameErrorText(
                        frameDocument
                    );

                if (stage === 'prepare') {
                    const submit =
                        findSubmitControl(
                            frameDocument,
                            false
                        );

                    const unitInputs = {};

                    Object.entries(requiredUnits)
                        .forEach(
                            ([unit, amount]) => {
                                if (amount <= 0) {
                                    return;
                                }

                                unitInputs[unit] =
                                    frameDocument
                                        .querySelector(
                                            'input[name="' +
                                            unit +
                                            '"]'
                                        ) ||
                                    frameDocument
                                        .getElementById(
                                            'unit_input_' +
                                            unit
                                        );
                            }
                        );

                    if (!submit) {
                        return;
                    }

                    Object.entries(unitInputs)
                        .forEach(
                            ([unit, input]) => {
                                if (input) {
                                    return;
                                }

                                sentUnits[unit] = 0;
                                delete unitInputs[unit];
                            }
                        );

                    if (
                        !Object.keys(unitInputs)
                            .length
                    ) {
                        finish(
                            false,
                            'Nie znaleziono pól dla wybranych jednostek.'
                        );

                        return;
                    }

                    const availableSpy =
                        parseAvailableUnitCount(
                            'spy',
                            frameDocument
                        );

                    if (
                        availableSpy !== null &&
                        availableSpy < spyAmount
                    ) {
                        finish(
                            false,
                            'Brak zwiadowcy. Atak Auto został pominięty.'
                        );

                        return;
                    }

                    Object.entries(requiredUnits)
                        .forEach(
                            ([unit, required]) => {
                                if (
                                    unit === 'spy' ||
                                    required <= 0
                                ) {
                                    return;
                                }

                                const available =
                                    parseAvailableUnitCount(
                                        unit,
                                        frameDocument
                                    );

                                if (
                                    available !== null &&
                                    available < required
                                ) {
                                    sentUnits[unit] =
                                        available;
                                }
                            }
                        );

                    if (
                        requiredUnits.light > 0 &&
                        (
                            !sentUnits.light ||
                            sentUnits.light <= 0
                        )
                    ) {
                        finish(
                            false,
                            'Brak lekkiej kawalerii do wysłania.'
                        );

                        return;
                    }

                    if (
                        requiredUnits.spy > 0 &&
                        (
                            !sentUnits.spy ||
                            sentUnits.spy <= 0
                        )
                    ) {
                        finish(
                            false,
                            'Brak zwiadowcy do wysłania.'
                        );

                        return;
                    }

                    Object.entries(unitInputs)
                        .forEach(
                            ([unit, input]) => {
                                input.value =
                                    String(
                                        sentUnits[unit] || 0
                                    );

                                input.dispatchEvent(
                                    new Event(
                                        'input',
                                        {
                                            bubbles: true
                                        }
                                    )
                                );

                                input.dispatchEvent(
                                    new Event(
                                        'change',
                                        {
                                            bubbles: true
                                        }
                                    )
                                );
                            }
                        );

                    totalCell.textContent =
                        'Potwierdzanie...';

                    stage = 'wait-confirm';

                    const submitted =
                        submitFrameControl(
                            submit,
                            frameDocument
                        );

                    if (!submitted) {
                        finish(
                            false,
                            'Nie udało się otworzyć potwierdzenia ataku.'
                        );
                    }

                    return;
                }

                if (stage === 'wait-confirm') {
                    if (errorText) {
                        finish(
                            false,
                            'Serwer odrzucił przygotowanie ataku: ' +
                            errorText
                        );

                        return;
                    }

                    if (
                        !isFrameConfirmationPage(
                            frameDocument
                        )
                    ) {
                        return;
                    }

                    const submit =
                        findSubmitControl(
                            frameDocument,
                            true
                        );

                    if (!submit) {
                        return;
                    }

                    confirmationUrl =
                        getFrameUrl(
                            frameDocument
                        );

                    confirmClickedAt =
                        Date.now();

                    totalCell.textContent =
                        'Wysyłanie...';

                    stage = 'wait-result';

                    const submitted =
                        submitFrameControl(
                            submit,
                            frameDocument
                        );

                    if (!submitted) {
                        finish(
                            false,
                            'Nie udało się zatwierdzić ataku.'
                        );
                    }

                    return;
                }

                if (stage === 'wait-result') {
                    if (errorText) {
                        finish(
                            false,
                            'Serwer odrzucił atak: ' +
                            errorText
                        );

                        return;
                    }

                    if (
                        isFrameConfirmationPage(
                            frameDocument
                        )
                    ) {
                        if (
                            Date.now() -
                            confirmClickedAt >
                            8000
                        ) {
                            finish(
                                false,
                                'Potwierdzenie ataku nie zostało przyjęte przez serwer.'
                            );
                        }

                        return;
                    }

                    if (
                        Date.now() -
                        confirmClickedAt <
                        ajaxSettings.ajaxSentDelay
                    ) {
                        return;
                    }

                    if (
                        !hasOutgoingCommandResult(
                            frameDocument,
                            confirmationUrl
                        )
                    ) {
                        return;
                    }

                    finish(
                        true,
                        '',
                        frameDocument
                    );
                }
            } finally {
                processingFrame = false;
            }
        }

        iframe.addEventListener(
            'load',
            processFrame
        );

        watchdog = setInterval(
            processFrame,
            ajaxSettings.ajaxPollDelay
        );

        timeout = setTimeout(() => {
            finish(
                false,
                'Przekroczono czas ataku Auto. Zatrzymano na etapie: ' +
                stage
            );
        }, ajaxSettings.ajaxTimeout);

        iframe.src = url.href;
        document.body.appendChild(iframe);
    }

    function isAttackConfirmationPage() {
        const params =
            new URLSearchParams(
                location.search
            );

        if (
            params.get('try') === 'confirm'
        ) {
            return true;
        }

        if (
            params.get('action') === 'command'
        ) {
            return true;
        }

        return Array.from(
            document.querySelectorAll(
                'input[type="submit"], ' +
                'button[type="submit"]'
            )
        ).some(button => {
            const text = String(
                button.value ||
                button.textContent ||
                ''
            )
                .trim()
                .toLowerCase();

            return (
                text.includes('wyślij atak') ||
                text.includes('wyslij atak')
            );
        });
    }

    function handleAutoReturnFromPlace() {
        const params =
            new URLSearchParams(
                location.search
            );

        if (
            params.get('screen') !== 'place'
        ) {
            return false;
        }

        if (
            params.get('twmini_hidden') === '1'
        ) {
            return false;
        }

        const returnUrl =
            params.get('twmini_return');

        if (returnUrl) {
            sessionStorage.setItem(
                AUTO_RETURN_KEY,
                JSON.stringify({
                    url: returnUrl,
                    targetRow:
                        params.get(
                            'twmini_target_row'
                        ) || '',

                    scroll:
                        parseInt(
                            params.get(
                                'twmini_scroll'
                            ),
                            10
                        ) || 0
                })
            );

            if (
                !sessionStorage.getItem(
                    AUTO_RETURN_PHASE_KEY
                )
            ) {
                sessionStorage.setItem(
                    AUTO_RETURN_PHASE_KEY,
                    'prepare'
                );
            }
        }

        if (isAttackConfirmationPage()) {
            sessionStorage.setItem(
                AUTO_RETURN_PHASE_KEY,
                'confirm'
            );

            return false;
        }

        if (
            sessionStorage.getItem(
                AUTO_RETURN_PHASE_KEY
            ) !== 'confirm'
        ) {
            return false;
        }

        let state = null;

        try {
            state = JSON.parse(
                sessionStorage.getItem(
                    AUTO_RETURN_KEY
                )
            );
        } catch (error) {
            state = null;
        }

        sessionStorage.removeItem(
            AUTO_RETURN_KEY
        );

        sessionStorage.removeItem(
            AUTO_RETURN_PHASE_KEY
        );

        if (!state || !state.url) {
            return false;
        }

        const destination = new URL(
            state.url,
            location.href
        );

        if (state.targetRow) {
            destination.searchParams.set(
                'twmini_restore_target',
                state.targetRow
            );
        }

        destination.searchParams.set(
            'twmini_restore_scroll',
            String(state.scroll || 0)
        );

        location.replace(
            destination.href
        );

        return true;
    }

    function fillAutoUnitsOnPlace() {
        const params =
            new URLSearchParams(
                location.search
            );

        if (
            params.get('screen') !== 'place'
        ) {
            return;
        }

        if (isAttackConfirmationPage()) {
            return;
        }

        let requiredLight =
            parseInt(
                params.get('twmini_light'),
                10
            ) || 0;

        const spyAmount =
            parseInt(
                params.get('twmini_spy'),
                10
            ) || 0;

        const wallFromParam =
            parseInt(
                params.get('twmini_wall'),
                10
            );

        const wallLevel =
            Number.isNaN(wallFromParam)
                ? getPlaceWallLevel()
                : wallFromParam;

        if (
            wallLevel === 1 &&
            requiredLight > 0 &&
            requiredLight < 4
        ) {
            requiredLight = 4;
        }

        if (
            requiredLight <= 0 ||
            spyAmount <= 0
        ) {
            return;
        }

        let attempts = 0;

        function tryFill() {
            attempts++;

            const lightInput =
                document.querySelector(
                    'input[name="light"]'
                ) ||
                document.getElementById(
                    'unit_input_light'
                );

            const spyInput =
                document.querySelector(
                    'input[name="spy"]'
                ) ||
                document.getElementById(
                    'unit_input_spy'
                );

            if (
                !lightInput ||
                !spyInput
            ) {
                if (attempts < 30) {
                    setTimeout(
                        tryFill,
                        100
                    );
                }

                return;
            }

            const availableLight =
                parseAvailableUnitCount(
                    'light'
                );

            let lightAmount =
                requiredLight;

            const currentLight =
                parseInt(
                    lightInput.value,
                    10
                ) || 0;

            if (
                wallLevel === 1 &&
                currentLight < 4 &&
                !(
                    params.has(
                        'twmini_light'
                    ) &&
                    requiredLight >= 4
                )
            ) {
                disablePlaceAttackButtons(
                    'Mur 1 wymaga co najmniej 4 LK. Aby wysłać atak, ustaw 4 LK.'
                );

                return;
            }

            if (
                availableLight !== null &&
                availableLight < requiredLight
            ) {
                const accepted = confirm(
                    'Potrzeba ' +
                    requiredLight +
                    ' LK, ale dostępne jest tylko ' +
                    availableLight +
                    '. Wpisać tylko ' +
                    availableLight +
                    ' LK?'
                );

                if (!accepted) {
                    return;
                }

                lightAmount =
                    availableLight;
            }

            lightInput.value =
                String(lightAmount);

            spyInput.value =
                String(spyAmount);

            lightInput.dispatchEvent(
                new Event(
                    'input',
                    { bubbles: true }
                )
            );

            lightInput.dispatchEvent(
                new Event(
                    'change',
                    { bubbles: true }
                )
            );

            spyInput.dispatchEvent(
                new Event(
                    'input',
                    { bubbles: true }
                )
            );

            spyInput.dispatchEvent(
                new Event(
                    'change',
                    { bubbles: true }
                )
            );
        }

        tryFill();
    }

    function applyResourcesToRow(
        row,
        resources
    ) {
        const values = [
            [
                getResourceValueElement(
                    row,
                    ['wood']
                ),
                resources.wood
            ],
            [
                getResourceValueElement(
                    row,
                    ['stone', 'clay']
                ),
                resources.clay
            ],
            [
                getResourceValueElement(
                    row,
                    ['iron']
                ),
                resources.iron
            ]
        ];

        values.forEach(
            ([element, value]) => {
                if (!element) {
                    return;
                }

                if (
                    !element.hasAttribute(
                        'data-tw-mini-original-text'
                    )
                ) {
                    element.setAttribute(
                        'data-tw-mini-original-text',
                        element.textContent
                    );

                    element.setAttribute(
                        'data-tw-mini-original-title',
                        element.title || ''
                    );
                }

                element.textContent =
                    formatCompactResource(value);

                element.title =
                    'Wyszpiegowane surowce z raportu: ' +
                    formatResourceNumber(value);

                element.classList.add(
                    'twMiniSpiedResource'
                );
            }
        );

        ensureTotalColumnHeader();

        const totalElement =
            ensureTotalColumnCell(row);

        const total =
            resources.wood +
            resources.clay +
            resources.iron;

        row.dataset.twMiniResourceTotal =
            String(total);

        totalElement.textContent =
            formatCompactResource(total);

        totalElement.title =
            'Suma wyszpiegowanych surowców: ' +
            formatResourceNumber(total);

        attachAutoAction(
            row,
            totalElement,
            total
        );
    }

    function restoreResourceValues() {
        document.querySelectorAll(
            '[data-tw-mini-original-text]'
        ).forEach(element => {
            element.textContent =
                element.getAttribute(
                    'data-tw-mini-original-text'
                );

            element.title =
                element.getAttribute(
                    'data-tw-mini-original-title'
                ) || '';

            element.removeAttribute(
                'data-tw-mini-original-text'
            );

            element.removeAttribute(
                'data-tw-mini-original-title'
            );

            element.classList.remove(
                'twMiniSpiedResource'
            );
        });

        document.querySelectorAll(
            '.twMiniResourceTotalCell, ' +
            '.twMiniResourceTotalHeader'
        ).forEach(element => {
            element.remove();
        });

        getVillageRows().forEach(row => {
            delete row.dataset
                .twMiniResourceTotal;
        });

        const summary =
            document.getElementById(
                'twResourcesSummary'
            );

        const status =
            document.getElementById(
                'twResourcesStatus'
            );

        if (summary) {
            summary.textContent = 'Suma: —';
        }

        if (status) {
            status.textContent = '';
        }
    }

    function getFarmReportJobs() {
        return getVillageRows()
            .filter(row => {
                return row.style.display !== 'none';
            })
            .map(row => {
                const link = row.querySelector(
                    'a[href*="screen=report"]' +
                    '[href*="view="]'
                );

                return link
                    ? {
                        row,
                        url: link.href
                    }
                    : null;
            })
            .filter(Boolean);
    }

    function loadPersistentReportCache() {
        if (reportCacheLoaded) {
            return;
        }

        reportCacheLoaded = true;

        try {
            const stored =
                JSON.parse(
                    localStorage.getItem(
                        REPORT_RESOURCE_CACHE_KEY
                    )
                ) || {};

            const now = Date.now();

            Object.entries(stored)
                .forEach(([url, entry]) => {
                    if (
                        entry &&
                        entry.resources &&
                        now -
                        (entry.savedAt || 0) <=
                        REPORT_CACHE_MAX_AGE
                    ) {
                        reportResourceCache.set(
                            url,
                            entry.resources
                        );
                    }
                });
        } catch (error) {
            console.warn(
                'Nie udało się odczytać pamięci raportów:',
                error
            );
        }
    }

    function savePersistentReportCache() {
        const stored = {};
        const savedAt = Date.now();

        reportResourceCache.forEach(
            (resources, url) => {
                if (resources) {
                    stored[url] = {
                        resources,
                        savedAt
                    };
                }
            }
        );

        try {
            localStorage.setItem(
                REPORT_RESOURCE_CACHE_KEY,
                JSON.stringify(stored)
            );
        } catch (error) {
            console.warn(
                'Nie udało się zapisać pamięci raportów:',
                error
            );
        }
    }

    async function fetchSpiedResources(url) {
        loadPersistentReportCache();

        if (
            reportResourceCache.has(url)
        ) {
            return reportResourceCache.get(url);
        }

        const response = await fetch(
            url,
            {
                credentials: 'include'
            }
        );

        if (!response.ok) {
            throw new Error(
                'HTTP ' + response.status
            );
        }

        const resources =
            parseSpiedResources(
                await response.text()
            );

        if (resources) {
            reportResourceCache.set(
                url,
                resources
            );

            savePersistentReportCache();
        }

        return resources;
    }

    async function readAndShowSpiedResources() {
        if (resourceReadInProgress) {
            return;
        }

        resourceReadInProgress = true;

        const settings = loadSettings();
        const runId = ++resourceReadRun;

        const status =
            document.getElementById(
                'twResourcesStatus'
            );

        const summary =
            document.getElementById(
                'twResourcesSummary'
            );

        const jobs =
            getFarmReportJobs();

        const totals = {
            wood: 0,
            clay: 0,
            iron: 0
        };

        let nextIndex = 0;
        let finished = 0;
        let found = 0;
        let failed = 0;

        const maxConcurrency = Math.max(
            1,
            Math.min(
                6,
                jobs.length || 1
            )
        );

        const updateStatus = () => {
            if (
                status &&
                runId === resourceReadRun
            ) {
                status.textContent =
                    'Czytanie raportów: ' +
                    finished +
                    '/' +
                    jobs.length;
            }
        };

        ensureTotalColumnHeader();

        getVillageRows().forEach(
            ensureTotalColumnCell
        );

        if (status) {
            status.textContent =
                'Czytanie raportów: 0/' +
                jobs.length;
        }

        async function worker() {
            while (
                nextIndex < jobs.length &&
                runId === resourceReadRun
            ) {
                const job =
                    jobs[nextIndex++];

                if (!job) {
                    continue;
                }

                loadPersistentReportCache();

                const wasCached =
                    reportResourceCache.has(
                        job.url
                    );

                try {
                    const resources =
                        await fetchSpiedResources(
                            job.url
                        );

                    if (
                        resources &&
                        runId === resourceReadRun
                    ) {
                        applyResourcesToRow(
                            job.row,
                            resources
                        );

                        totals.wood +=
                            resources.wood;

                        totals.clay +=
                            resources.clay;

                        totals.iron +=
                            resources.iron;

                        found++;
                    }
                } catch (error) {
                    failed++;

                    console.warn(
                        'Błąd odczytu raportu:',
                        job.url,
                        error
                    );
                }

                finished++;
                updateStatus();

                if (
                    !wasCached &&
                    settings.ajaxFetchDelay > 0 &&
                    document.visibilityState ===
                    'visible' &&
                    nextIndex < jobs.length &&
                    runId === resourceReadRun
                ) {
                    await new Promise(resolve => {
                        setTimeout(
                            resolve,
                            settings.ajaxFetchDelay
                        );
                    });
                }
            }
        }

        try {
            await Promise.all(
                Array.from(
                    {
                        length: maxConcurrency
                    },
                    worker
                )
            );
        } finally {
            resourceReadInProgress = false;
        }

        if (runId !== resourceReadRun) {
            return;
        }

        if (summary) {
            summary.textContent =
                'Suma: ' +
                formatResourceNumber(
                    totals.wood
                ) +
                ' drewna | ' +
                formatResourceNumber(
                    totals.clay
                ) +
                ' gliny | ' +
                formatResourceNumber(
                    totals.iron
                ) +
                ' żelaza | razem ' +
                formatResourceNumber(
                    totals.wood +
                    totals.clay +
                    totals.iron
                );
        }

        if (status) {
            status.textContent =
                'Gotowe: ' +
                found +
                ' raportów' +
                (
                    failed
                        ? ', błędy: ' +
                        failed
                        : ''
                );
        }

        scheduleFilters();
    }

    function setShowResources(enabled) {
        localStorage.setItem(
            SHOW_RESOURCES_KEY,
            enabled
                ? '1'
                : '0'
        );

        if (enabled) {
            readAndShowSpiedResources();
        } else {
            resourceReadRun++;
            restoreResourceValues();
            scheduleFilters();
        }
    }

    function appendRowsFromPage(html) {
        const parser =
            new DOMParser();

        const doc =
            parser.parseFromString(
                html,
                'text/html'
            );

        const currentTable =
            document.getElementById(
                'plunder_list'
            );

        const currentTbody =
            currentTable.querySelector(
                'tbody'
            );

        const newRows = Array.from(
            doc.querySelectorAll(
                '#plunder_list tr'
            )
        );

        newRows.forEach(row => {
            if (row.querySelector('th')) {
                return;
            }

            if (
                row.id &&
                document.getElementById(row.id)
            ) {
                return;
            }

            currentTbody.appendChild(
                document.importNode(
                    row,
                    true
                )
            );
        });

        villageCache = null;
    }

    function getPaginationLinks(root) {
        return Array.from(
            root.querySelectorAll(
                '.paged-nav-item[href]'
            )
        )
            .map(link => {
                try {
                    return new URL(
                        link.getAttribute('href'),
                        location.href
                    ).href;
                } catch (error) {
                    return '';
                }
            })
            .filter(Boolean);
    }

    async function checkAllPages() {
        const settings =
            loadSettings();

        const buttons = [
            document.getElementById(
                'twCheckAllPages'
            ),
            document.getElementById(
                'twShowAllPages'
            )
        ].filter(Boolean);

        const setButtonState = (
            text,
            disabled
        ) => {
            buttons.forEach(button => {
                button.disabled = disabled;
                button.textContent = text;
            });
        };

        setButtonState(
            'Sprawdzam...',
            true
        );

        getPaginationLinks(document)
            .forEach(href => {
                discoveredPageUrls.add(href);
            });

        const links = Array.from(
            discoveredPageUrls
        ).filter(href => {
            return !loadedPageUrls.has(href);
        });

        let loaded = 0;
        let failed = 0;
        let index = 0;

        while (index < links.length) {
            const href = links[index++];

            try {
                const response = await fetch(
                    href,
                    {
                        credentials: 'include'
                    }
                );

                if (!response.ok) {
                    throw new Error(
                        'HTTP ' +
                        response.status
                    );
                }

                const html =
                    await response.text();

                appendRowsFromPage(html);

                const pageDocument =
                    new DOMParser()
                        .parseFromString(
                            html,
                            'text/html'
                        );

                getPaginationLinks(
                    pageDocument
                ).forEach(pageHref => {
                    discoveredPageUrls.add(
                        pageHref
                    );

                    if (
                        !loadedPageUrls.has(
                            pageHref
                        ) &&
                        !links.includes(pageHref)
                    ) {
                        links.push(pageHref);
                    }
                });

                loadedPageUrls.add(href);
                loaded++;

                setButtonState(
                    'Strony: ' +
                    loaded +
                    '/' +
                    links.length,
                    true
                );

                if (index < links.length) {
                    await new Promise(
                        resolve => {
                            setTimeout(
                                resolve,
                                settings.ajaxFetchDelay
                            );
                        }
                    );
                }
            } catch (error) {
                failed++;

                console.warn(
                    'Błąd pobierania strony:',
                    href,
                    error
                );
            }
        }

        if (scheduledFrame !== null) {
            cancelAnimationFrame(
                scheduledFrame
            );
        }

        applyFilters();

        const showResources =
            document.getElementById(
                'twShowResources'
            );

        if (
            showResources &&
            showResources.checked
        ) {
            readAndShowSpiedResources();
        }

        if (failed === 0) {
            document.querySelectorAll(
                '#plunder_list_nav'
            ).forEach(nav => {
                nav.style.display = 'none';
            });

            setButtonState(
                'Wszystkie wyświetlone',
                false
            );

            return;
        }

        setButtonState(
            'Ponów brakujące strony (' +
            failed +
            ')',
            false
        );
    }

    async function restoreFarmPosition() {
        const params =
            new URLSearchParams(
                location.search
            );

        const targetId =
            params.get(
                'twmini_restore_target'
            );

        const savedScroll =
            parseInt(
                params.get(
                    'twmini_restore_scroll'
                ),
                10
            ) || 0;

        if (
            !targetId &&
            !params.has(
                'twmini_restore_scroll'
            )
        ) {
            return;
        }

        let targetRow = targetId
            ? document.getElementById(
                targetId
            )
            : null;

        if (!targetRow && targetId) {
            await checkAllPages();

            targetRow =
                document.getElementById(
                    targetId
                );
        }

        requestAnimationFrame(() => {
            if (
                targetRow &&
                targetRow.style.display !==
                'none'
            ) {
                targetRow.scrollIntoView({
                    block: 'center'
                });
            } else {
                window.scrollTo(
                    0,
                    savedScroll
                );
            }
        });

        const cleanUrl =
            new URL(location.href);

        cleanUrl.searchParams.delete(
            'twmini_restore_target'
        );

        cleanUrl.searchParams.delete(
            'twmini_restore_scroll'
        );

        history.replaceState(
            null,
            '',
            cleanUrl.href
        );
    }

    function createPanel() {
        const table =
            document.getElementById(
                'plunder_list'
            );

        if (!table) {
            return;
        }

        if (
            document.getElementById(
                'twFarmFilterPanel'
            )
        ) {
            return;
        }

        const settings =
            loadSettings();

        const panel =
            document.createElement('div');

        panel.id = 'twFarmFilterPanel';

        const quickFilters =
            document.createElement('div');

        quickFilters.id =
            'twQuickFilters';

        quickFilters.innerHTML = `
            <div class="twQuickGroup twQuickWall">
                <label>
                    <input type="checkbox" id="twHideWall1">
                    Ukryj 1
                </label>

                <label>
                    <input type="checkbox" id="twHideWall1Plus">
                    Ukryj 1+
                </label>

                <label>
                    Pokaż tylko mur
                    <input
                        type="number"
                        id="twOnlyWall"
                        min="0"
                        step="1"
                        placeholder="2"
                    >
                </label>
            </div>

            <div class="twQuickGroup twQuickDistance">
                <span>Odległość</span>

                <input
                    type="number"
                    id="twMinDistance"
                    min="0"
                    step="0.1"
                    placeholder="5"
                >

                <span>–</span>

                <input
                    type="number"
                    id="twMaxDistance"
                    min="0"
                    step="0.1"
                    placeholder="20"
                >
            </div>

            <label
                class="twQuickResources"
                title="0 wyłącza filtr"
            >
                <input
                    type="checkbox"
                    id="twMaxResources"
                >

                <span>Pokaż max</span>

                Min. surowców

                <input
                    type="number"
                    id="twMinResources"
                    min="0"
                    step="100"
                    value="0"
                >
            </label>
        `;

        function createToggleButton(id) {
            const button =
                document.createElement('button');

            button.id = id;
            button.type = 'button';
            button.className =
                'twSectionToggle';

            return button;
        }

        const miniToggle =
            createToggleButton(
                'twToggleMiniFilters'
            );

        const originalToggle =
            createToggleButton(
                'twToggleOriginalFilters'
            );

        const templatesToggle =
            createToggleButton(
                'twToggleTemplates'
            );

        const miniControls =
            document.createElement('div');

        miniControls.id =
            'twMiniControls';

        const miniTitle =
            document.createElement('strong');

        miniTitle.id =
            'twMiniTitle';

        miniTitle.textContent =
            'Filtry MiniAF';

        const optionsButton =
            document.createElement('button');

        optionsButton.id =
            'twOpenOptions';

        optionsButton.type = 'button';

        optionsButton.className =
            'twSectionToggle';

        optionsButton.textContent =
            '⚙ Opcje';

        const showAllButton =
            document.createElement('button');

        showAllButton.id =
            'twShowAllPages';

        showAllButton.type = 'button';

        showAllButton.className =
            'twSectionToggle';

        showAllButton.textContent =
            'Pokaż wszystkie';

        miniControls.appendChild(
            miniTitle
        );

        miniControls.appendChild(
            optionsButton
        );

        miniControls.appendChild(
            showAllButton
        );

        miniControls.appendChild(
            miniToggle
        );

        const optionsModal =
            document.createElement('div');

        optionsModal.id =
            'twOptionsModal';

        optionsModal.innerHTML = `
            <div
                id="twOptionsWindow"
                role="dialog"
                aria-modal="true"
                aria-labelledby="twOptionsTitle"
            >
                <div id="twOptionsHeader">
                    <h3 id="twOptionsTitle">
                        Opcje MiniAF
                    </h3>

                    <button
                        id="twCloseOptions"
                        type="button"
                        aria-label="Zamknij"
                    >
                        ×
                    </button>
                </div>

                <div id="twOptionsContent">
                    <label class="twOptionRow">
                        <span>
                            <strong>Kliknięcie w sumę</strong>
                            <br>
                            Wybierz, czy komórka Razem wysyła atak w tle, czy otwiera plac.
                        </span>

                        <select id="twSumClickMode">
                            <option value="ajax">
                                Ajax
                            </option>

                            <option value="place">
                                Plac
                            </option>
                        </select>
                    </label>

                    <label class="twOptionInline twAjaxDelayOption">
                        Szybkość Ajax:

                        <input
                            type="number"
                            id="twAjaxDelay"
                            min="0"
                            step="50"
                            value="${settings.ajaxDelay}"
                        >
                    </label>

                    <label class="twOptionInline twAjaxDelayOption">
                        Sprawdzanie iframe:

                        <input
                            type="number"
                            id="twAjaxPollDelay"
                            min="100"
                            step="50"
                            value="${settings.ajaxPollDelay}"
                        >

                        ms
                    </label>

                    <label class="twOptionInline twAjaxDelayOption">
                        Czekaj po wysłaniu:

                        <input
                            type="number"
                            id="twAjaxSentDelay"
                            min="0"
                            step="100"
                            value="${settings.ajaxSentDelay}"
                        >

                        ms
                    </label>

                    <label class="twOptionInline twAjaxDelayOption">
                        Timeout ataku:

                        <input
                            type="number"
                            id="twAjaxTimeout"
                            min="5000"
                            step="1000"
                            value="${settings.ajaxTimeout}"
                        >

                        ms
                    </label>

                    <label class="twOptionInline twAjaxDelayOption">
                        Pauza pobierania:

                        <input
                            type="number"
                            id="twAjaxFetchDelay"
                            min="0"
                            step="20"
                            value="${settings.ajaxFetchDelay}"
                        >

                        ms przerwy
                    </label>

                    <label class="twOptionRow">
                        <input
                            type="checkbox"
                            id="twShowResources"
                        >

                        <span>
                            <strong>Pokaż surowce</strong>
                            <br>
                            Odczytaj wyszpiegowane surowce z raportów i podsumuj je.
                        </span>
                    </label>

                    <div id="twResourcesStatus"></div>
                    <div id="twResourcesSummary">Suma: —</div>
                </div>
            </div>
        `;

        function createOptionsAccordion(
            icon,
            title,
            summary,
            contentNodes,
            closed
        ) {
            const section =
                document.createElement(
                    'section'
                );

            section.className =
                'twOptionsAccordion' +
                (
                    closed
                        ? ' twClosed'
                        : ''
                );

            section.innerHTML = `
                <button
                    type="button"
                    class="twOptionsAccordionHeader"
                >
                    <span class="twOptionsAccordionIcon">
                        ${icon}
                    </span>

                    <span class="twOptionsAccordionTitle">
                        <strong>${title}</strong>
                        <small>${summary}</small>
                    </span>

                    <span class="twOptionsAccordionArrow">
                        ▼
                    </span>
                </button>

                <div class="twOptionsAccordionBody"></div>
            `;

            const body =
                section.querySelector(
                    '.twOptionsAccordionBody'
                );

            contentNodes.forEach(node => {
                if (node) {
                    body.appendChild(node);
                }
            });

            section.querySelector(
                '.twOptionsAccordionHeader'
            ).addEventListener(
                'click',
                () => {
                    section.classList.toggle(
                        'twClosed'
                    );
                }
            );

            return section;
        }

        function rebuildOptionsPanel() {
            const content =
                optionsModal.querySelector(
                    '#twOptionsContent'
                );

            if (!content) {
                return;
            }

            const sumMode =
                optionsModal.querySelector(
                    '#twSumClickMode'
                )
                    ? optionsModal
                        .querySelector(
                            '#twSumClickMode'
                        )
                        .closest(
                            '.twOptionRow'
                        )
                    : null;

            const ajaxControls =
                Array.from(
                    optionsModal.querySelectorAll(
                        '.twAjaxDelayOption'
                    )
                );

            const showResources =
                optionsModal.querySelector(
                    '#twShowResources'
                )
                    ? optionsModal
                        .querySelector(
                            '#twShowResources'
                        )
                        .closest(
                            '.twOptionRow'
                        )
                    : null;

            const status =
                optionsModal.querySelector(
                    '#twResourcesStatus'
                );

            const summary =
                optionsModal.querySelector(
                    '#twResourcesSummary'
                );

            const list =
                document.createElement('div');

            list.className =
                'twOptionsAccordionList';

            list.appendChild(
                createOptionsAccordion(
                    '1',
                    'Kliknięcie w sumę i Ajax',
                    'Tryb wysyłania oraz prędkość ataku w tle',
                    [sumMode].concat(
                        ajaxControls
                    ),
                    false
                )
            );

            list.appendChild(
                createOptionsAccordion(
                    '2',
                    'Raporty i surowce',
                    'Czytanie wyszpiegowanych surowców z raportów',
                    [
                        showResources,
                        status,
                        summary
                    ],
                    true
                )
            );

            content.innerHTML = '';
            content.appendChild(list);
        }

        rebuildOptionsPanel();

        panel.innerHTML = `
            <div class="twFilterSection">
                <span class="twFilterSectionTitle">
                    Raporty
                </span>

                <div class="twFilterControls">
                    <label>
                        <input
                            type="checkbox"
                            id="twOnlyKnownWall"
                        >

                        Tylko znany
                    </label>

                    <label>
                        Raporty

                        <select id="twReportMode">
                            <option value="all">
                                Wszystkie
                            </option>

                            <option value="with">
                                Z raportem
                            </option>

                            <option value="without">
                                Bez raportu
                            </option>
                        </select>
                    </label>
                </div>
            </div>

            <div class="twFilterSection">
                <span class="twFilterSectionTitle">
                    Lista
                </span>

                <div class="twFilterControls">
                    <label title="0 oznacza wszystkie wioski">
                        Liczba na liście

                        <input
                            type="number"
                            id="twListLimit"
                            min="0"
                            step="1"
                            value="0"
                        >
                    </label>

                    <button
                        id="twCheckAllPages"
                        type="button"
                    >
                        Pokaż wszystkie
                    </button>
                </div>
            </div>
        `;

        panel.style.cssText = `
            display:grid;
            grid-template-columns:repeat(2, minmax(0, 1fr));
            gap:0;
            margin:0 0 8px;
            padding:0;
            border:1px solid #c9a96b;
            border-top:0;
            background:rgba(255,245,218,.45);
            font-weight:bold;
        `;

        const style =
            document.createElement('style');

        style.textContent = `
            #twFarmFilterPanel label {
                display:inline-flex;
                align-items:center;
                gap:4px;
                white-space:nowrap;
            }

            #twFarmFilterPanel .twFilterSection {
                min-width:0;
                padding:8px 10px 10px;
                border-right:1px solid #d6bc84;
            }

            #twFarmFilterPanel .twFilterSection:last-child {
                border-right:0;
            }

            #twFarmFilterPanel .twFilterSectionTitle {
                display:block;
                margin-bottom:7px;
                color:#694714;
                font-size:11px;
                letter-spacing:.05em;
                text-transform:uppercase;
            }

            #twFarmFilterPanel .twFilterControls {
                display:flex;
                align-items:center;
                flex-wrap:wrap;
                gap:7px 10px;
            }

            #twFarmFilterPanel input[type="number"] {
                width:58px;
                box-sizing:border-box;
            }

            #twFarmFilterPanel #twMinResources {
                width:76px;
            }

            #twFarmFilterPanel select {
                max-width:115px;
            }

            #twFarmFilterPanel button {
                white-space:nowrap;
            }

            #twQuickFilters {
                display:grid;
                grid-template-columns:minmax(0, 1fr) auto auto;
                align-items:center;
                gap:8px 16px;
                margin:6px 0 8px;
                padding:7px 9px;
                border:1px solid #c9a96b;
                background:rgba(255,245,218,.55);
                font-weight:bold;
            }

            #twQuickFilters label,
            #twQuickFilters .twQuickGroup {
                display:inline-flex;
                align-items:center;
                gap:5px;
                white-space:nowrap;
            }

            #twQuickFilters .twQuickWall {
                flex-wrap:wrap;
                gap:7px 12px;
            }

            #twQuickFilters input[type="number"] {
                width:58px;
                box-sizing:border-box;
            }

            #twQuickFilters #twMinResources {
                width:76px;
            }

            #twQuickFilters .twQuickResources {
                justify-self:end;
            }

            .twSectionToggle {
                display:block;
                margin:6px 2px;
                min-width:155px;
                font-weight:bold;
                cursor:pointer;
            }

            #twToggleMiniFilters {
                width:fit-content;
                margin-right:2px;
            }

            #twMiniControls {
                display:flex;
                align-items:center;
                gap:6px;
                margin-top:8px;
                padding:6px 8px;
                border:1px solid #c9a96b;
                background:#e5c98e;
            }

            #twMiniTitle {
                margin-right:auto;
                color:#5b3d11;
                font-size:14px;
            }

            #twOptionsModal {
                position:fixed;
                inset:0;
                z-index:100000;
                display:none;
                align-items:center;
                justify-content:center;
                padding:20px;
                background:rgba(0, 0, 0, 0.55);
                box-sizing:border-box;
            }

            #twOptionsWindow {
                width:min(680px, 100%);
                max-height:85vh;
                overflow:auto;
                border:2px solid #7d510f;
                border-radius:5px;
                background:#f4e4bc;
                box-shadow:0 8px 30px rgba(0, 0, 0, 0.45);
            }

            #twOptionsHeader {
                display:flex;
                align-items:center;
                justify-content:space-between;
                padding:10px 14px;
                border-bottom:1px solid #c9a96b;
                background:#e5c98e;
            }

            #twOptionsHeader h3 {
                margin:0;
            }

            #twCloseOptions {
                min-width:34px;
                min-height:30px;
                font-size:22px;
                line-height:1;
                cursor:pointer;
            }

            #twOptionsContent {
                min-height:160px;
                padding:14px;
            }

            #twOptionsContent .twOptionsAccordionList {
                display:grid;
                gap:8px;
            }

            #twOptionsContent .twOptionsAccordion {
                overflow:hidden;
                border:1px solid #c69a4f;
                border-radius:7px;
                background:rgba(255,251,237,.78);
            }

            #twOptionsContent .twOptionsAccordionHeader {
                display:flex;
                align-items:center;
                gap:9px;
                width:100%;
                min-height:52px;
                padding:9px 12px;
                border:0;
                border-bottom:1px solid #d3ad66;
                background:linear-gradient(90deg, #e6c47e, #f7e8bf);
                color:#2f210f;
                font:inherit;
                font-weight:bold;
                text-align:left;
                cursor:pointer;
            }

            #twOptionsContent .twOptionsAccordion.twClosed .twOptionsAccordionHeader {
                border-bottom:0;
            }

            #twOptionsContent .twOptionsAccordionIcon {
                display:inline-flex;
                align-items:center;
                justify-content:center;
                flex:0 0 28px;
                width:28px;
                height:28px;
                border:1px solid rgba(91,57,12,.22);
                border-radius:50%;
                background:rgba(255,255,255,.45);
                font-weight:bold;
            }

            #twOptionsContent .twOptionsAccordionTitle {
                display:block;
                flex:1;
                min-width:0;
            }

            #twOptionsContent .twOptionsAccordionTitle strong,
            #twOptionsContent .twOptionsAccordionTitle small {
                display:block;
            }

            #twOptionsContent .twOptionsAccordionTitle small {
                margin-top:2px;
                color:#70501f;
                font-size:12px;
                font-weight:normal;
            }

            #twOptionsContent .twOptionsAccordionArrow {
                flex:0 0 auto;
                transition:transform .16s ease;
            }

            #twOptionsContent .twOptionsAccordion.twClosed .twOptionsAccordionArrow {
                transform:rotate(-90deg);
            }

            #twOptionsContent .twOptionsAccordionBody {
                padding:12px;
            }

            #twOptionsContent .twOptionsAccordion.twClosed .twOptionsAccordionBody {
                display:none;
            }

            #twOptionsContent .twOptionRow {
                display:flex;
                align-items:flex-start;
                gap:8px;
                padding:10px;
                border:1px solid #c9a96b;
                background:#fff5da;
                cursor:pointer;
            }

            #twOptionsContent .twOptionRow input {
                margin-top:3px;
            }

            #twOptionsContent .twOptionRow select {
                margin-left:auto;
                min-width:90px;
            }

            #twOptionsContent .twOptionInline {
                display:flex;
                align-items:center;
                gap:8px;
                margin:8px 0;
                font-weight:bold;
                cursor:pointer;
            }

            #twOptionsContent .twAjaxDelayOption input {
                width:76px;
                height:24px;
                padding:2px 5px;
                border:1px solid #b89454;
                border-radius:3px;
                background:#fffaf0;
                box-sizing:border-box;
                text-align:center;
            }

            #twResourcesStatus {
                margin-top:12px;
                color:#5c451e;
            }

            #twResourcesSummary {
                margin-top:8px;
                padding:8px 10px;
                border:1px solid #c9a96b;
                background:#fff5da;
                font-weight:bold;
            }

            #plunder_list .twMiniSpiedResource {
                color:#1f6b18;
                font-weight:bold;
            }

            #plunder_list .twMiniResourceTotalHeader {
                width:64px;
                text-align:center;
                white-space:nowrap;
            }

            #plunder_list .twMiniResourceTotalCell {
                position:relative;
                width:64px;
                padding:3px 6px;
                border-bottom:1px solid #7d510f;
                background:#f5d88e;
                color:#7a2600;
                font-size:15px;
                font-weight:800;
                text-align:center;
                vertical-align:middle;
                white-space:nowrap;
            }

            #plunder_list .twMiniResourceTotalCell.twMiniAutoAvailable {
                cursor:pointer;
            }

            #plunder_list .twMiniResourceTotalCell.twMiniAutoAvailable:hover {
                background:#edc967;
            }

            #plunder_list .twMiniResourceTotalCell.twMiniAutoRunning {
                background:#d5b45d;
                color:#3b260b;
            }

            #plunder_list .twMiniResourceTotalCell.twMiniAutoQueued {
                background:#c7d6f3;
                color:#16345d;
            }

            #plunder_list .twMiniResourceTotalCell.twMiniAutoSent {
                background:#b9df9a;
                color:#27510c;
            }

            @media (max-width:850px) {
                #twFarmFilterPanel {
                    grid-template-columns:1fr;
                }

                #twFarmFilterPanel .twFilterSection {
                    border-right:0;
                    border-bottom:1px solid #d6bc84;
                }

                #twFarmFilterPanel .twFilterSection:last-child {
                    border-bottom:0;
                }

                #twQuickFilters {
                    grid-template-columns:1fr;
                }

                #twQuickFilters .twQuickResources {
                    justify-self:start;
                }
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(optionsModal);

        table.parentNode.insertBefore(
            panel,
            table
        );

        table.parentNode.insertBefore(
            quickFilters,
            table
        );

        table.parentNode.insertBefore(
            miniControls,
            panel
        );

        const originalFilters =
            document.getElementById(
                'plunder_list_filters'
            );

        const originalFilterToggler =
            document.querySelector(
                '.filter_display_toggler'
            );

        if (originalFilterToggler) {
            originalFilterToggler.parentNode
                .insertBefore(
                    originalToggle,
                    originalFilterToggler
                );

            originalFilterToggler.style.display =
                'none';
        } else if (originalFilters) {
            originalFilters.parentNode
                .insertBefore(
                    originalToggle,
                    originalFilters
                );
        }

        const templatesPanel =
            getTemplatesPanel();

        const originalTemplatesButton =
            document.querySelector(
                'button[onclick*="fa_edit"]'
            );

        if (originalTemplatesButton) {
            originalTemplatesButton.parentNode
                .insertBefore(
                    templatesToggle,
                    originalTemplatesButton
                );

            originalTemplatesButton.style.display =
                'none';
        } else if (templatesPanel) {
            templatesPanel.parentNode
                .insertBefore(
                    templatesToggle,
                    templatesPanel
                );
        }

        const miniButton =
            document.getElementById(
                'twToggleMiniFilters'
            );

        const originalButton =
            document.getElementById(
                'twToggleOriginalFilters'
            );

        const templatesButton =
            document.getElementById(
                'twToggleTemplates'
            );

        miniButton.addEventListener(
            'click',
            () => {
                setMiniFiltersVisible(
                    miniButton.getAttribute(
                        'aria-expanded'
                    ) !== 'true'
                );
            }
        );

        originalButton.addEventListener(
            'click',
            () => {
                setOriginalFiltersVisible(
                    originalButton.getAttribute(
                        'aria-expanded'
                    ) !== 'true'
                );
            }
        );

        templatesButton.addEventListener(
            'click',
            () => {
                setTemplatesVisible(
                    templatesButton.getAttribute(
                        'aria-expanded'
                    ) !== 'true'
                );
            }
        );

        optionsButton.addEventListener(
            'click',
            () => {
                setOptionsVisible(true);
            }
        );

        document.getElementById(
            'twCloseOptions'
        ).addEventListener(
            'click',
            () => {
                setOptionsVisible(false);
            }
        );

        optionsModal.addEventListener(
            'click',
            event => {
                if (
                    event.target ===
                    optionsModal
                ) {
                    setOptionsVisible(false);
                }
            }
        );

        document.addEventListener(
            'keydown',
            event => {
                if (event.key === 'Escape') {
                    setOptionsVisible(false);
                }
            }
        );

        const showResourcesCheckbox =
            document.getElementById(
                'twShowResources'
            );

        showResourcesCheckbox.checked = true;

        localStorage.setItem(
            SHOW_RESOURCES_KEY,
            '1'
        );

        showResourcesCheckbox.addEventListener(
            'change',
            () => {
                setShowResources(
                    showResourcesCheckbox.checked
                );
            }
        );

        setMiniFiltersVisible(
            localStorage.getItem(
                VISIBILITY_KEYS.mini
            ) !== '0'
        );

        setOriginalFiltersVisible(
            localStorage.getItem(
                VISIBILITY_KEYS.original
            ) === '1'
        );

        setTemplatesVisible(
            localStorage.getItem(
                VISIBILITY_KEYS.templates
            ) === '1'
        );

        document.getElementById(
            'twHideWall1'
        ).checked =
            settings.hideWall1 === true;

        document.getElementById(
            'twHideWall1Plus'
        ).checked =
            settings.hideWall1Plus === true;

        document.getElementById(
            'twOnlyKnownWall'
        ).checked =
            settings.onlyKnownWall === true;

        document.getElementById(
            'twReportMode'
        ).value =
            settings.reportMode ||
            (
                settings.onlyWithReport
                    ? 'with'
                    : ''
            ) ||
            (
                settings.onlyWithoutReport
                    ? 'without'
                    : ''
            ) ||
            'all';

        document.getElementById(
            'twMinDistance'
        ).value =
            settings.minDistance || '';

        document.getElementById(
            'twMaxDistance'
        ).value =
            settings.maxDistance || '';

        document.getElementById(
            'twOnlyWall'
        ).value =
            settings.onlyWall || '';

        document.getElementById(
            'twMinResources'
        ).value =
            settings.minResources || '0';

        document.getElementById(
            'twMaxResources'
        ).checked =
            settings.maxResources === true;

        document.getElementById(
            'twListLimit'
        ).value =
            settings.listLimit || '0';

        document.getElementById(
            'twSumClickMode'
        ).value =
            settings.sumClickMode;

        document.getElementById(
            'twAjaxDelay'
        ).value =
            settings.ajaxDelay;

        document.getElementById(
            'twAjaxPollDelay'
        ).value =
            settings.ajaxPollDelay;

        document.getElementById(
            'twAjaxSentDelay'
        ).value =
            settings.ajaxSentDelay;

        document.getElementById(
            'twAjaxTimeout'
        ).value =
            settings.ajaxTimeout;

        document.getElementById(
            'twAjaxFetchDelay'
        ).value =
            settings.ajaxFetchDelay;

        document.getElementById(
            'twSumClickMode'
        ).addEventListener(
            'change',
            () => {
                saveSettings(
                    readSettings()
                );
            }
        );

        [
            'twAjaxDelay',
            'twAjaxPollDelay',
            'twAjaxSentDelay',
            'twAjaxTimeout',
            'twAjaxFetchDelay'
        ].forEach(id => {
            document.getElementById(id)
                .addEventListener(
                    'input',
                    () => {
                        saveSettings(
                            readSettings()
                        );
                    }
                );

            document.getElementById(id)
                .addEventListener(
                    'change',
                    () => {
                        saveSettings(
                            readSettings()
                        );
                    }
                );
        });

        FILTER_IDS.forEach(id => {
            const input =
                document.getElementById(id);

            if (input.type === 'checkbox') {
                input.addEventListener(
                    'change',
                    () => {
                        scheduleFilters();
                        scheduleResourceRefresh();
                    }
                );
            } else {
                input.addEventListener(
                    'input',
                    () => {
                        scheduleNumberFilters();
                        scheduleResourceRefresh();
                    }
                );

                input.addEventListener(
                    'change',
                    () => {
                        scheduleFilters();
                        scheduleResourceRefresh();
                    }
                );
            }
        });

        [
            document.getElementById(
                'twCheckAllPages'
            ),
            document.getElementById(
                'twShowAllPages'
            )
        ]
            .filter(Boolean)
            .forEach(button => {
                button.addEventListener(
                    'click',
                    () => {
                        void checkAllPages();
                    }
                );
            });

        applyFilters();
        setShowResources(true);
    }

    if (!handleAutoReturnFromPlace()) {
        fillAutoUnitsOnPlace();
    }

    createPanel();
    restoreFarmPosition();
})();