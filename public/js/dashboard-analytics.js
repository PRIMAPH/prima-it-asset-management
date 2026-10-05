/* ============================================================
   PRIMA IT ASSET MANAGEMENT
   MANAGEMENT DASHBOARD ANALYTICS
   ============================================================ */

(() => {

  'use strict';


  // ==========================================================
  // GLOBALS
  // ==========================================================

  const charts = {};

  const $ = (id) =>
    document.getElementById(id);


  // ==========================================================
  // PHP / PESO FORMAT
  // ==========================================================

  const peso = (value) =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));


  // ==========================================================
  // CHART PALETTE
  // ==========================================================

  const palette = [
    '#2dd4bf',
    '#7dd3fc',
    '#fbbf24',
    '#fb7185',
    '#a78bfa',
    '#67e8f9',
    '#fdba74',
    '#94a3b8',
    '#6ee7b7',
    '#f9a8d4',
    '#bef264'
  ];

  const statusColors = {
    Available: '#2dd4bf', Assigned: '#7dd3fc',
    'For Repair': '#fbbf24', Repairing: '#a78bfa',
    Broken: '#fb7185', Lost: '#fdba74',
    'For Disposal': '#f9a8d4', Disposed: '#94a3b8', Retired: '#64748b'
  };

  function applyChartTheme() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = '#9baebf';
    Chart.defaults.borderColor = 'rgba(155, 174, 191, 0.12)';
    Chart.defaults.font.family = '"Segoe UI", Inter, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.padding = 18;
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: '#1c2c3b', titleColor: '#e7edf4', bodyColor: '#cbd7e2',
      borderColor: '#35495b', borderWidth: 1, padding: 12, cornerRadius: 8
    });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      Chart.defaults.animation = false;
    }
  }


  // ==========================================================
  // ALERT
  // ==========================================================

  function showAlert(message, type = 'danger') {

    const box = $('analyticsAlert');

    if (!box) return;

    box.className =
      `alert alert-${type}`;

    box.textContent = message;
  }


  function clearAlert() {

    const box = $('analyticsAlert');

    if (!box) return;

    box.className =
      'alert d-none';

    box.textContent = '';
  }


  // ==========================================================
  // DESTROY CHART
  // ==========================================================

  function destroyChart(name) {

    if (charts[name]) {

      charts[name].destroy();

      charts[name] = null;

    }

  }


  // ==========================================================
  // EMPTY STATE
  // ==========================================================

  function setEmpty(
    canvasId,
    emptyId,
    empty
  ) {

    const canvas = $(canvasId);

    const message = $(emptyId);

    if (canvas) {

      canvas.style.display =
        empty ? 'none' : '';

    }

    if (message) {

      message.classList.toggle(
        'd-none',
        !empty
      );

    }

  }


  // ==========================================================
  // HELPERS
  // ==========================================================

  function normalizeRows(rows) {

    return Array.isArray(rows)
      ? rows
      : [];

  }


  function labels(rows) {

    return normalizeRows(rows)
      .map(row =>
        String(row.label ?? 'Unknown')
      );

  }


  function values(rows) {

    return normalizeRows(rows)
      .map(row =>
        Number(row.value ?? 0)
      );

  }


  function escapeHtml(value) {

    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  }


  // ==========================================================
  // STATUS DOUGHNUT
  // ==========================================================

  function renderStatus(rows) {

    const data =
      normalizeRows(rows)
        .filter(row =>
          Number(row.value ?? 0) > 0
        );


    destroyChart('status');


    setEmpty(
      'assetStatusChart',
      'assetStatusEmpty',
      data.length === 0
    );


    if (
      !data.length ||
      typeof Chart === 'undefined'
    ) {
      return;
    }


    charts.status =
      new Chart(
        $('assetStatusChart'),
        {
          type: 'doughnut',

          data: {

            labels:
              labels(data),

            datasets: [{

              data:
                values(data),

              backgroundColor:
                data.map((row, index) => statusColors[row.label] || palette[index % palette.length]),

              borderWidth: 1,

              borderColor:
                '#121c26'

            }]

          },

          options: {

            responsive: true,

            maintainAspectRatio: false,

            cutout: '62%',

            plugins: {

              legend: {
                position: 'right'
              },

              tooltip: {

                callbacks: {

                  label: context => {

                    const value =
                      context.parsed || 0;

                    return `${context.label}: ${value}`;

                  }

                }

              }

            }

          }

        }
      );

  }


  // ==========================================================
  // BAR CHART
  // ==========================================================

  function renderBar(
    canvasId,
    emptyId,
    key,
    rows,
    horizontal = false
  ) {

    const data =
      normalizeRows(rows);


    destroyChart(key);


    setEmpty(
      canvasId,
      emptyId,
      data.length === 0
    );


    if (
      !data.length ||
      typeof Chart === 'undefined'
    ) {
      return;
    }


    charts[key] =
      new Chart(
        $(canvasId),
        {

          type: 'bar',

          data: {

            labels:
              labels(data),

            datasets: [{

              label:
                'Assets',

              data:
                values(data),

              backgroundColor:
                '#2dd4bf',

              borderRadius:
                6,

              maxBarThickness:
                34

            }]

          },

          options: {

            indexAxis:
              horizontal ? 'y' : 'x',

            responsive: true,

            maintainAspectRatio: false,

            scales: {

              x: {

                beginAtZero: true,

                ticks: {
                  precision: 0
                }

              },

              y: {

                beginAtZero: true,

                ticks: {
                  precision: 0
                }

              }

            },

            plugins: {

              legend: {
                display: false
              }

            }

          }

        }
      );

  }


  // ==========================================================
  // INVENTORY VALUE
  // ==========================================================

  function renderInventoryValue(summary) {

    const total =
      $('inventoryValueTotal');

    const list =
      $('inventoryValueList');


    if (total) {

      total.textContent =
        peso(summary?.inventory_value || 0);

    }


    if (!list) return;


    const rows = [
      {
        label: 'Available',
        value: summary?.available_value || 0
      },
      {
        label: 'Assigned',
        value: summary?.assigned_value || 0
      },
      {
        label: 'For Repair',
        value: summary?.for_repair_value || 0
      },
      {
        label: 'Repairing',
        value: summary?.repairing_value || 0
      },
      {
        label: 'Broken',
        value: summary?.broken_value || 0
      },
      {
        label: 'Lost',
        value: summary?.lost_value || 0
      }
    ];


    list.innerHTML =
      rows
        .filter(row =>
          Number(row.value) > 0
        )
        .map(row => `

          <div class="value-row">

            <span class="value-label">
              ${escapeHtml(row.label)}
            </span>

            <span class="value-amount">
              ${peso(row.value)}
            </span>

          </div>

        `)
        .join('');

  }


  // ==========================================================
  // REPAIR STATUS CHART
  // ==========================================================

function renderRepairStatus(rows) {

  const data = normalizeRows(rows)
    .map(row => ({
      label: String(row.label || 'Unknown'),
      value: Number(row.value || 0)
    }));

  destroyChart('repairTrend');

  setEmpty(
    'repairTrendChart',
    'repairTrendEmpty',
    data.every(row => row.value === 0)
  );

  if (
    data.every(row => row.value === 0) ||
    typeof Chart === 'undefined'
  ) {
    return;
  }

  charts.repairTrend = new Chart(
    $('repairTrendChart'),
    {
      type: 'line',

      data: {
        labels: data.map(row => row.label),

        datasets: [{
          label: 'Repair Records',
          data: data.map(row => row.value),
          borderColor: '#2dd4bf',
          backgroundColor: '#2dd4bf',
          borderWidth: 3,
          tension: 0.35,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          }
        },

        plugins: {
          legend: {
            display: false
          },

          tooltip: {
            callbacks: {
              label: context =>
                `Repair Records: ${context.parsed.y}`
            }
          }
        }
      }
    }
  );
}

  // ==========================================================
  // REPAIR COST CHART
  // ==========================================================

  function renderRepairCost(rows) {

  const data = normalizeRows(rows)
    .map(row => ({
      label: String(row.label || 'Unknown'),
      value: Number(row.value || 0)
    }));

  destroyChart('repairCost');

  setEmpty(
    'repairCostChart',
    'repairCostEmpty',
    data.every(row => row.value === 0)
  );

  if (
    data.every(row => row.value === 0) ||
    typeof Chart === 'undefined'
  ) {
    return;
  }

  charts.repairCost = new Chart(
    $('repairCostChart'),
    {
      type: 'line',

      data: {
        labels: data.map(row => row.label),

        datasets: [{
          label: 'Repair Cost',
          data: data.map(row => row.value),
          borderColor: '#7dd3fc',
          backgroundColor: '#7dd3fc',
          borderWidth: 3,
          tension: 0.35,
          fill: false,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        scales: {
          y: {
            beginAtZero: true,

            ticks: {
              callback: value => peso(value)
            }
          }
        },

        plugins: {
          legend: {
            display: false
          },

          tooltip: {
            callbacks: {
              label: context =>
                `Repair Cost: ${peso(context.parsed.y)}`
            }
          }
        }
      }
    }
  );
}


  // ==========================================================
  // LOAD ANALYTICS
  // ==========================================================

  async function loadAnalytics() {

    clearAlert();


    const button =
      $('refreshAnalyticsBtn');


    if (button) {
      button.disabled = true;
    }


    try {

      const response =
        await fetch(
          '/api/dashboard/analytics',
          {
            credentials: 'include',
            cache: 'no-store'
          }
        );


      const data =
        await response
          .json()
          .catch(() => ({}));


      if (!response.ok) {

        throw new Error(
          data.message ||
          'Unable to load dashboard analytics.'
        );

      }


      // ======================================================
      // STATUS
      // ======================================================

      renderStatus(
        data.status || []
      );


      // ======================================================
      // INVENTORY VALUE
      // ======================================================

      renderInventoryValue(
        data.summary || {}
      );


      // ======================================================
      // CATEGORY
      // ======================================================

      renderBar(
        'assetCategoryChart',
        'assetCategoryEmpty',
        'category',
        data.category || []
      );


      // ======================================================
      // DEPARTMENT
      // ======================================================

      renderBar(
        'assetDepartmentChart',
        'assetDepartmentEmpty',
        'department',
        data.department || [],
        true
      );


      // ======================================================
      // REPAIRS
      // ======================================================


renderRepairStatus(data.repairTrend || []);
renderRepairCost(data.repairCost || []);


      // ======================================================
      // LOCATION
      // ======================================================

      renderBar(
        'assetLocationChart',
        'assetLocationEmpty',
        'location',
        data.location || [],
        true
      );


      // ======================================================
      // WARRANTY INFORMATION
      // ======================================================

      console.log(
        'Warranty analytics:',
        data.warranty || {}
      );


    } catch (error) {

      console.error(
        'Dashboard analytics error:',
        error
      );


      showAlert(
        error.message ||
        'Unable to load dashboard analytics.'
      );


    } finally {

      if (button) {
        button.disabled = false;
      }

    }

  }


  // ==========================================================
  // INITIALIZE
  // ==========================================================

  function init() {

    if (!$('assetStatusChart')) {
      return;
    }


    applyChartTheme();
    loadAnalytics();


    const button =
      $('refreshAnalyticsBtn');


    if (button) {

      button.addEventListener(
        'click',
        loadAnalytics
      );

    }

  }


  // ==========================================================
  // GLOBAL ACCESS
  // ==========================================================

  window.PrimaDashboardAnalytics = {
    load: loadAnalytics
  };


  // ==========================================================
  // DOM READY
  // ==========================================================

  if (
    document.readyState === 'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      init
    );

  } else {

    init();

  }

})();
