/**
 * Menu buttons: <button data-menu-button aria-controls="id"> next to a
 * <div class="menu" id="id" role="menu"> inside a .menu-anchor.
 * Opens on click, Enter or Space; arrow keys, Home and End move between
 * items; Escape, Tab, an outside click or choosing an item closes it and
 * returns focus to the button.
 */
(function () {
    'use strict';

    let openMenu = null;
    let openButton = null;

    function items(menu) {
        return Array.from(menu.querySelectorAll('button:not([disabled]), a[href], [role="menuitem"]'));
    }

    function close(returnFocus) {
        if (!openMenu) return;
        openMenu.classList.remove('open');
        if (openButton) {
            openButton.setAttribute('aria-expanded', 'false');
            if (returnFocus) openButton.focus();
        }
        openMenu = null;
        openButton = null;
    }

    function open(button, menu) {
        close(false);
        menu.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
        openMenu = menu;
        openButton = button;
        const first = items(menu)[0];
        if (first) first.focus();
    }

    document.addEventListener('click', function (event) {
        const button = event.target.closest('[data-menu-button]');
        if (button) {
            const menu = document.getElementById(button.getAttribute('aria-controls'));
            if (!menu) return;
            event.stopPropagation();
            if (openMenu === menu) close(true);
            else open(button, menu);
            return;
        }
        if (openMenu && !openMenu.contains(event.target)) close(false);
    });

    // Choosing an item: close first and put focus back on the menu button,
    // so a dialog the item opens returns focus there when it closes.
    document.addEventListener('click', function (event) {
        if (!openMenu || !openMenu.contains(event.target)) return;
        if (!event.target.closest('button, a[href], [role="menuitem"]')) return;
        close(true);
    }, true);

    document.addEventListener('keydown', function (event) {
        if (!openMenu) return;
        const list = items(openMenu);
        const i = list.indexOf(document.activeElement);
        let next = null;
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
            return;
        }
        if (event.key === 'Tab') {
            close(false);
            return;
        }
        if (event.key === 'ArrowDown') next = list[(i + 1) % list.length];
        else if (event.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length];
        else if (event.key === 'Home') next = list[0];
        else if (event.key === 'End') next = list[list.length - 1];
        if (next) {
            event.preventDefault();
            next.focus();
        }
    });
})();
