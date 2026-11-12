(function () {
    'use strict';

    var grid = document.getElementById('installer-grid');

    function showMessage(message) {
        var empty = document.createElement('div');
        empty.className = 'portal-empty';
        empty.textContent = message;
        grid.replaceChildren(empty);
    }

    fetch('/api/portal/installers', { credentials: 'omit' })
        .then(function (response) {
            if (!response.ok) throw new Error('Installer request failed');
            return response.json();
        })
        .then(function (data) {
            if (!data || !data.success || !Array.isArray(data.installers)) {
                throw new Error('Invalid installer response');
            }
            if (data.installers.length === 0) {
                showMessage('No installers available yet.');
                return;
            }
            var labels = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };
            var cards = data.installers.map(function (installer) {
                var url = new URL(installer.url, window.location.origin);
                if (url.origin !== window.location.origin || !url.pathname.startsWith('/downloads/generic-agent/')) {
                    throw new Error('Invalid installer URL');
                }
                var card = document.createElement('div');
                card.className = 'portal-card';
                var heading = document.createElement('h3');
                heading.textContent = Object.hasOwn(labels, installer.platform) ? labels[installer.platform] : installer.platform;
                var arch = document.createElement('div');
                arch.className = 'arch';
                arch.textContent = (installer.arch || '') + ' · ' + (installer.format || '');
                var link = document.createElement('a');
                link.className = 'portal-btn';
                link.href = url.href;
                link.textContent = 'Download';
                card.append(heading, arch, link);
                return card;
            });
            grid.replaceChildren.apply(grid, cards);
        })
        .catch(function () {
            showMessage('Failed to load installers.');
        });
})();
