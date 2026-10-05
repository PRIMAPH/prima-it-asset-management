// ============================================================
// PRIMA IT ASSET MANAGEMENT
// GLOBAL LIGHT / DARK THEME MANAGER
// ============================================================

(function () {

  const STORAGE_KEY =
    'prima_theme';


  const VALID_THEMES = [
    'light',
    'dark',
    'system'
  ];


  // ==========================================================
  // SYSTEM THEME
  // ==========================================================

  function getSystemTheme() {

    return window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches
      ? 'dark'
      : 'light';

  }


  // ==========================================================
  // GET SAVED PREFERENCE
  // ==========================================================

  function getPreference() {

    const saved =
      localStorage.getItem(
        STORAGE_KEY
      );


    if (
      VALID_THEMES.includes(saved)
    ) {

      return saved;

    }


    // Current PRIMA default
    return 'dark';

  }


  // ==========================================================
  // RESOLVE PREFERENCE
  // ==========================================================

  function resolveTheme(
    preference
  ) {

    if (
      preference === 'system'
    ) {

      return getSystemTheme();

    }


    return preference;

  }


  // ==========================================================
  // ENABLE / DISABLE DARK CSS
  // ==========================================================

  function updateDarkStyles(
    resolvedTheme
  ) {

    document
      .querySelectorAll(
        'link[data-dark-theme]'
      )
      .forEach(link => {

        link.disabled =
          resolvedTheme !== 'dark';

      });

  }


  // ==========================================================
  // META THEME COLOR
  // ==========================================================

  function updateThemeColor(
    resolvedTheme
  ) {

    const meta =
      document.getElementById(
        'themeColorMeta'
      );


    if (!meta) return;


    meta.setAttribute(
      'content',
      resolvedTheme === 'dark'
        ? '#0b1118'
        : '#f5f7fb'
    );

  }


  // ==========================================================
  // UPDATE SETTINGS CONTROLS
  // ==========================================================

  function updateControls(
    preference,
    resolvedTheme
  ) {

    const radio =
      document.querySelector(
        `input[name="themePreference"][value="${preference}"]`
      );


    if (radio) {

      radio.checked = true;

    }


    const text =
      document.getElementById(
        'currentThemeText'
      );


    if (text) {

      if (
        preference === 'system'
      ) {

        text.textContent =
          `System Default (${capitalize(resolvedTheme)})`;

      } else {

        text.textContent =
          capitalize(
            resolvedTheme
          );

      }

    }


    // ========================================================
    // SYSTEM INFORMATION
    // ========================================================

    const systemAppearance =
      document.getElementById(
        'systemAppearance'
      );


    if (systemAppearance) {

      systemAppearance.textContent =
        preference === 'system'
          ? `System / ${capitalize(resolvedTheme)}`
          : capitalize(resolvedTheme);

    }

  }


  // ==========================================================
  // CAPITALIZE
  // ==========================================================

  function capitalize(
    value
  ) {

    const text =
      String(value || '');


    return (
      text.charAt(0)
        .toUpperCase() +
      text.slice(1)
    );

  }


  // ==========================================================
  // APPLY THEME
  // ==========================================================

  function applyTheme(
    preference =
      getPreference()
  ) {

    if (
      !VALID_THEMES.includes(
        preference
      )
    ) {

      preference = 'dark';

    }


    const resolvedTheme =
      resolveTheme(
        preference
      );


    // Bootstrap 5.3
    document
      .documentElement
      .setAttribute(
        'data-bs-theme',
        resolvedTheme
      );


    // PRIMA
    document
      .documentElement
      .setAttribute(
        'data-theme',
        resolvedTheme
      );


    document
      .documentElement
      .setAttribute(
        'data-theme-preference',
        preference
      );


    updateDarkStyles(
      resolvedTheme
    );


    updateThemeColor(
      resolvedTheme
    );


    updateControls(
      preference,
      resolvedTheme
    );


    // Notify other modules if needed
    window.dispatchEvent(
      new CustomEvent(
        'prima-theme-changed',
        {
          detail: {
            preference,
            theme:
              resolvedTheme
          }
        }
      )
    );

  }


  // ==========================================================
  // SET THEME
  // ==========================================================

  function setTheme(
    preference
  ) {

    if (
      !VALID_THEMES.includes(
        preference
      )
    ) {

      return;

    }


    localStorage.setItem(
      STORAGE_KEY,
      preference
    );


    applyTheme(
      preference
    );

  }


  // ==========================================================
  // APPLY AS SOON AS THIS FILE LOADS
  // ==========================================================

  applyTheme();


  // ==========================================================
  // DOM READY
  // ==========================================================

  document.addEventListener(
    'DOMContentLoaded',
    () => {

      applyTheme();


      document
        .querySelectorAll(
          'input[name="themePreference"]'
        )
        .forEach(radio => {

          radio.addEventListener(
            'change',
            () => {

              if (
                radio.checked
              ) {

                setTheme(
                  radio.value
                );

              }

            }
          );

        });

    }
  );


  // ==========================================================
  // WINDOWS / OS THEME CHANGE
  // ==========================================================

  const systemTheme =
    window.matchMedia(
      '(prefers-color-scheme: dark)'
    );


  systemTheme.addEventListener(
    'change',
    () => {

      if (
        getPreference() ===
        'system'
      ) {

        applyTheme(
          'system'
        );

      }

    }
  );


  // ==========================================================
  // GLOBAL API
  // ==========================================================

  window.PRIMATheme = {

    set:
      setTheme,

    get:
      getPreference,

    apply:
      applyTheme,

    current:
      () =>
        resolveTheme(
          getPreference()
        )

  };

})();