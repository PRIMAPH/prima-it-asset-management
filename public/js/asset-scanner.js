(function () {
    "use strict";

    let scanAssetModal = null;
    let assetScanner = null;
    let scannerRunning = false;
    let scanProcessing = false;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (value === null || value === undefined) return "";

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatDate(value) {
        if (!value) return "-";

        try {
            const d = new Date(value);

            if (Number.isNaN(d.getTime())) {
                return value;
            }

            return d.toLocaleDateString("en-PH", {
                year: "numeric",
                month: "short",
                day: "2-digit"
            });
        } catch {
            return value;
        }
    }

    function scannerStatusBadge(status) {
        const value = String(status || "").toLowerCase();

        let cls = "bg-secondary";

        if (value === "available") cls = "bg-success";
        else if (value === "assigned") cls = "bg-primary";
        else if (value === "for repair") cls = "bg-warning text-dark";
        else if (value === "repairing") cls = "bg-info text-dark";
        else if (value === "broken") cls = "bg-danger";
        else if (value === "lost") cls = "bg-dark";
        else if (value === "disposed") cls = "bg-secondary";
        else if (value === "retired") cls = "bg-dark";

        return `<span class="badge ${cls}">${escapeHtml(status || "-")}</span>`;
    }

    // ============================================================
// ASSET IMAGE URL
// ============================================================

function getScannerAssetImageUrl(imagePath) {

    if (!imagePath) {
        return "";
    }

    const value =
        String(imagePath).trim();

    if (!value) {
        return "";
    }

    // Already an absolute URL
    if (
        value.startsWith("http://") ||
        value.startsWith("https://") ||
        value.startsWith("data:")
    ) {
        return value;
    }

    // Already starts with /
    if (value.startsWith("/")) {
        return value;
    }

    return "/" + value;
}

    function setScannerMessage(message, type = "info") {
        const box = document.getElementById("scannerMessage");

        if (!box) return;

        box.className = `alert alert-${type} py-2 px-3 mb-2`;
        box.innerHTML = message;
        box.classList.remove("d-none");
    }

function getRepairJobOrderNumber(value) {

    const scannedValue =
        String(value || "")
            .trim();

    if (!scannedValue) {
        return "";
    }

    // Detect Repair Job Order number anywhere
    // inside the scanned QR / barcode value.
    const match =
        scannedValue.match(
            /REP-\d{4}-\d{6}/i
        );

    return match
        ? match[0].toUpperCase()
        : "";
}

function getRepairIdFromScannedUrl(value) {

    const scannedValue =
        String(value || "")
            .trim();

    if (!scannedValue) {
        return 0;
    }

    try {
        const url =
            new URL(
                scannedValue,
                window.location.origin
            );

        const pathname =
            url.pathname
                .replace(/\/+$/, "")
                .toLowerCase();

        let repairIdValue = "";

        if (pathname === "/repair-job-order.html") {
            repairIdValue =
                url.searchParams.get("id") ||
                url.searchParams.get("repair_id") ||
                "";
        } else if (
            pathname === "/maintenance" ||
            pathname === "/maintenance.html"
        ) {
            repairIdValue =
                url.searchParams.get("repair_id") ||
                "";
        } else {
            return 0;
        }

        const normalizedId =
            String(repairIdValue).trim();

        if (!/^\d+$/.test(normalizedId)) {
            return 0;
        }

        const repairId =
            Number(normalizedId);

        return Number.isSafeInteger(repairId) &&
            repairId > 0
            ? repairId
            : 0;

    } catch {
        return 0;
    }
}

    async function openScannedRepairJobOrder(
        repairNumber
    ) {
        setScannerMessage(
            "Finding Repair Job Order...",
            "info"
        );

        try {
            const response =
                await fetch(
                    `/api/repairs?search=${encodeURIComponent(
                        repairNumber
                    )}`,
                    {
                        credentials: "include",
                        headers: {
                            Accept: "application/json"
                        }
                    }
                );

            const data =
                await response
                    .json()
                    .catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    data.message ||
                    "Unable to search Repair Job Orders."
                );
            }

            const records =
                Array.isArray(data)
                    ? data
                    : (
                        data.repairs ||
                        data.records ||
                        []
                    );

            const repair =
                records.find(record =>
                    String(
                        record.repair_no ||
                        record.repair_number ||
                        ""
                    )
                        .trim()
                        .toUpperCase() === repairNumber
                );

            const repairId =
                Number(repair?.id || 0);

            if (!repairId) {
                setScannerMessage(
                    `Repair Job Order <strong>${escapeHtml(
                        repairNumber
                    )}</strong> was not found.`,
                    "danger"
                );

                scanProcessing = false;
                return;
            }

            await stopAssetScanner();

            if (scanAssetModal) {
                scanAssetModal.hide();
            }

            window.location.href =
                `/maintenance?repair_id=${encodeURIComponent(
                    repairId
                )}`;

        } catch (error) {
            console.error(
                "Repair Job Order scan error:",
                error
            );

            setScannerMessage(
                `Unable to open Repair Job Order.<br>
                 <small>${escapeHtml(
                     error?.message || error
                 )}</small>`,
                "danger"
            );

            scanProcessing = false;
        }
    }

    // ============================================================
    // CREATE SCANNER MODAL
    // ============================================================

    function ensureScannerModal() {
        let modal = document.getElementById("scanAssetModal");

        if (!modal) {
            document.body.insertAdjacentHTML(
                "beforeend",
                `
                <div class="modal fade" id="scanAssetModal" tabindex="-1"
                     aria-labelledby="scanAssetModalLabel" aria-hidden="true">

                    <div class="modal-dialog modal-dialog-centered modal-lg">

                        <div class="modal-content">

                            <div class="modal-header">
                                <h5 class="modal-title" id="scanAssetModalLabel">
                                    <i class="bi bi-qr-code-scan me-2"></i>
                                    Scan QR / Barcode
                                </h5>

                                <button type="button"
                                        class="btn-close"
                                        data-bs-dismiss="modal"
                                        aria-label="Close">
                                </button>
                            </div>

                            <div class="modal-body">

                                <div id="scannerMessage"
                                     class="alert alert-info py-2 px-3 mb-2 d-none">
                                </div>

                                <div id="scannerLoading"
                                     class="text-center py-3 d-none">

                                    <div class="spinner-border text-primary"
                                         role="status">
                                    </div>

                                    <div class="small text-muted mt-2">
                                        Starting camera...
                                    </div>

                                </div>

                                <div id="assetScanner"
                                     style="
                                         width:100%;
                                         max-width:700px;
                                         margin:auto;
                                         min-height:280px;
                                         background:#000;
                                         border-radius:8px;
                                         overflow:hidden;
                                     ">
                                </div>

                                <div class="mt-3">

                                    <label for="manualAssetSearch"
                                           class="form-label fw-semibold">
                                        Manual Scanner Search
                                    </label>

                                    <div class="input-group">

                                        <input type="text"
                                               id="manualAssetSearch"
                                               class="form-control"
                                               placeholder="Enter Asset Tag, Barcode, or Repair No.">

                                        <button type="button"
                                                class="btn btn-primary"
                                                id="manualAssetSearchBtn">

                                            <i class="bi bi-search me-1"></i>
                                            Search

                                        </button>

                                    </div>

                                </div>

                                <div class="text-center mt-3">

                                    <button type="button"
                                            class="btn btn-outline-secondary btn-sm"
                                            id="retryAssetScannerBtn">

                                        <i class="bi bi-arrow-clockwise me-1"></i>
                                        Restart Camera

                                    </button>

                                </div>

                            </div>

                        </div>

                    </div>
                </div>
                `
            );

            modal = document.getElementById("scanAssetModal");
        }

        if (window.bootstrap) {
            scanAssetModal =
                bootstrap.Modal.getOrCreateInstance(modal);
        }

        return modal;
    }

    // ============================================================
    // OPEN SCANNER
    // ============================================================

    window.openScannerPage = function () {

        if (!window.bootstrap) {
            console.error(
                "PRIMA Scanner: Bootstrap is not loaded."
            );
            return;
        }

        const modal = ensureScannerModal();

        scanAssetModal =
            bootstrap.Modal.getOrCreateInstance(modal);

        scanAssetModal.show();
    };

    // ============================================================
    // CONNECT SCAN BUTTON
    // ============================================================

    function connectAssetScanButton() {

        const button =
            document.getElementById("scanAssetBtn");

        if (!button) {
            console.log(
                "Asset Scan button not present on this page."
            );
            return;
        }

        if (button.dataset.scannerConnected === "1") {
            return;
        }

        button.dataset.scannerConnected = "1";

        button.addEventListener("click", function () {
            window.openScannerPage();
        });
    }

    // ============================================================
    // SCANNER SETUP
    // ============================================================

    function setupAssetScanner() {

        const modal =
            document.getElementById("scanAssetModal");

        if (!modal) return;

        modal.addEventListener(
            "shown.bs.modal",
            function () {

                setTimeout(() => {
                    startAssetScanner();
                }, 300);

            }
        );

        modal.addEventListener(
            "hidden.bs.modal",
            function () {

                stopAssetScanner();

            }
        );

        const manualButton =
            document.getElementById(
                "manualAssetSearchBtn"
            );

        manualButton?.addEventListener(
            "click",
            manualAssetSearch
        );

        const manualInput =
            document.getElementById(
                "manualAssetSearch"
            );

        manualInput?.addEventListener(
            "keydown",
            function (event) {

                if (event.key === "Enter") {
                    event.preventDefault();
                    manualAssetSearch();
                }

            }
        );

        const retryButton =
            document.getElementById(
                "retryAssetScannerBtn"
            );

        retryButton?.addEventListener(
            "click",
            function () {

                stopAssetScanner();

                setTimeout(() => {
                    startAssetScanner();
                }, 300);

            }
        );
    }

    // ============================================================
    // CAMERA
    // ============================================================

    async function getAvailableCameras() {

        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.enumerateDevices
        ) {
            return [];
        }

        try {

            const devices =
                await navigator.mediaDevices.enumerateDevices();

            return devices.filter(
                device => device.kind === "videoinput"
            );

        } catch (error) {

            console.error(
                "Unable to enumerate cameras:",
                error
            );

            return [];
        }
    }

  async function startAssetScanner() {

    if (scannerRunning) {
        return;
    }

    if (typeof Html5Qrcode === "undefined") {

        setScannerMessage(
            "QR/Barcode scanner library is not loaded.",
            "danger"
        );

        return;
    }

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {

        setScannerMessage(
            "Camera access is not supported by this browser.",
            "danger"
        );

        return;
    }

    if (
        !window.isSecureContext &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1"
    ) {

        setScannerMessage(
            "Camera access requires HTTPS or localhost.",
            "warning"
        );

        return;
    }

    const loading =
        document.getElementById("scannerLoading");

    loading?.classList.remove("d-none");

    setScannerMessage(
        "Starting camera...",
        "info"
    );

    try {

        const scannerElement =
            document.getElementById("assetScanner");

        if (!scannerElement) {
            throw new Error(
                "Scanner container was not found."
            );
        }

        scannerElement.innerHTML = "";

        /*
         * ========================================================
         * REQUEST CAMERA PERMISSION
         * ========================================================
         */

        try {

            const permissionStream =
                await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });

            permissionStream
                .getTracks()
                .forEach(track => track.stop());

        } catch (permissionError) {

            console.error(
                "Camera permission error:",
                permissionError
            );

            throw new Error(
                "Camera permission was denied or the camera is unavailable."
            );
        }

        /*
         * ========================================================
         * GET CAMERAS
         * ========================================================
         */

        let cameras = [];

        try {

            cameras =
                await Html5Qrcode.getCameras();

        } catch (cameraError) {

            console.warn(
                "Unable to get camera list:",
                cameraError
            );

            cameras = [];
        }

        console.log(
            "PRIMA Scanner cameras:",
            cameras
        );

        /*
         * ========================================================
         * CREATE SCANNER
         * ========================================================
         */

        const scannerFormats =
            window.Html5QrcodeSupportedFormats
                ? [
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.CODE_93,
                    Html5QrcodeSupportedFormats.CODABAR,
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.UPC_A,
                    Html5QrcodeSupportedFormats.UPC_E
                ]
                    .filter(
                        format =>
                            format !== undefined &&
                            format !== null
                    )
                : [];

        const scannerOptions = {};

        if (scannerFormats.length) {
            scannerOptions.formatsToSupport =
                scannerFormats;
        }

        assetScanner =
            new Html5Qrcode(
                "assetScanner",
                scannerOptions
            );

        /*
         * ========================================================
         * SELECT CAMERA
         * ========================================================
         */

        let cameraOrConfig = null;

        if (
            Array.isArray(cameras) &&
            cameras.length > 0
        ) {

            /*
             * Prefer rear camera on phones.
             */
            const rearCamera =
                cameras.find(camera => {

                    const label =
                        String(
                            camera.label || ""
                        ).toLowerCase();

                    return (
                        label.includes("back") ||
                        label.includes("rear") ||
                        label.includes("environment")
                    );

                });

            if (rearCamera && rearCamera.id) {

                cameraOrConfig =
                    rearCamera.id;

            } else if (
                cameras[0] &&
                cameras[0].id
            ) {

                cameraOrConfig =
                    cameras[0].id;
            }
        }

        /*
         * ========================================================
         * FALLBACK CAMERA CONFIG
         * ========================================================
         *
         * IMPORTANT:
         * Use facingMode directly.
         * Do not use:
         *
         * { facingMode: { ideal: "environment" } }
         *
         * for this scanner version.
         */

        if (!cameraOrConfig) {

            cameraOrConfig = {
                facingMode: "environment"
            };
        }

        console.log(
            "PRIMA Scanner camera configuration:",
            cameraOrConfig
        );

        /*
         * ========================================================
         * SCANNER OPTIONS
         * ========================================================
         */

        const config = {

            fps: 15,

            qrbox: function (
                width,
                height
            ) {

                const scanWidth =
                    Math.max(
                        50,
                        Math.floor(
                            width * 0.90
                        )
                    );

                const scanHeight =
                    Math.max(
                        50,
                        Math.floor(
                            Math.min(
                                height * 0.50,
                                scanWidth * 0.40
                            )
                        )
                    );

                return {
                    width: scanWidth,
                    height: scanHeight
                };

            },

            aspectRatio: 1.777778

        };

        /*
         * ========================================================
         * START SCANNER
         * ========================================================
         */

        await assetScanner.start(

            cameraOrConfig,

            config,

            decodedText => {

                if (scanProcessing) {
                    return;
                }

                scanProcessing = true;

                console.log(
                    "PRIMA Scanner detected:",
                    decodedText
                );

                handleScannedAsset(
                    decodedText
                );

            },

            errorMessage => {
                // Normal QR/barcode scanning errors are ignored.
            }

        );

        scannerRunning = true;

        loading?.classList.add(
            "d-none"
        );

        setScannerMessage(
            "Camera ready. Scan an Asset Tag or Repair Job Order barcode.",
            "success"
        );

        console.log(
            "PRIMA Scanner started successfully."
        );

    } catch (error) {

        console.error(
            "Scanner start error:",
            error
        );

        loading?.classList.add(
            "d-none"
        );

        scannerRunning = false;

        if (assetScanner) {

            try {
                await assetScanner.clear();
            } catch {}

            assetScanner = null;
        }

        setScannerMessage(
            `Unable to start camera scanner.<br>
             <small>${escapeHtml(
                 error?.message ||
                 String(error)
             )}</small>`,
            "danger"
        );
    }
}
    // ============================================================
    // STOP CAMERA
    // ============================================================

    async function stopAssetScanner() {

        scanProcessing = false;

        if (!assetScanner) {
            scannerRunning = false;
            return;
        }

        try {

            if (scannerRunning) {
                await assetScanner.stop();
            }

        } catch (error) {

            console.warn(
                "Scanner stop warning:",
                error
            );

        }

        try {
            await assetScanner.clear();
        } catch {}

        assetScanner = null;
        scannerRunning = false;
    }

    // ============================================================
    // MANUAL SEARCH
    // ============================================================

    async function manualAssetSearch() {

        const input =
            document.getElementById(
                "manualAssetSearch"
            );

        const value =
            String(input?.value || "").trim();

        if (!value) {

            setScannerMessage(
                "Please enter an Asset Tag, Barcode, or Repair Number.",
                "warning"
            );

            return;
        }

        await handleScannedAsset(value);
    }

    // ============================================================
    // HANDLE SCANNED VALUE
    // ============================================================

    async function handleScannedAsset(value) {

        const scannedValue =
            String(value || "").trim();

        if (!scannedValue) {
            scanProcessing = false;
            return;
        }

        console.log(
            "PRIMA Scanner detected:",
            scannedValue
        );

        /*
         * --------------------------------------------------------
         * MAINTENANCE URL
         * --------------------------------------------------------
         */

        const repairId =
            getRepairIdFromScannedUrl(
                scannedValue
            );

        if (repairId) {

            await stopAssetScanner();

            if (scanAssetModal) {
                scanAssetModal.hide();
            }

            window.location.href =
                `/maintenance?repair_id=${encodeURIComponent(
                    repairId
                )}`;

            return;
        }

        /*
         * --------------------------------------------------------
         * REPAIR JOB ORDER
         * --------------------------------------------------------
         */

        const repairJobOrderNumber =
            getRepairJobOrderNumber(
                scannedValue
            );

        if (
            repairJobOrderNumber
        ) {
            console.log(
                "Repair Job Order detected:",
                repairJobOrderNumber
            );

            await openScannedRepairJobOrder(
                repairJobOrderNumber
            );

            return;
        }

        /*
         * --------------------------------------------------------
         * NORMAL ASSET SCAN
         * --------------------------------------------------------
         */

        try {

            setScannerMessage(
                "Finding asset...",
                "info"
            );

            const response =
                await fetch(
                    `/api/assets/scan/${encodeURIComponent(
                        scannedValue
                    )}`
                );

            const data =
                await response.json();

            if (!response.ok || !data.asset) {

                setScannerMessage(
                    escapeHtml(
                        data.message ||
                        "Asset was not found."
                    ),
                    "danger"
                );

                scanProcessing = false;

                return;
            }

            await stopAssetScanner();

            if (scanAssetModal) {
                scanAssetModal.hide();
            }

            await showScannedAssetDetails(
                data.asset
            );

        } catch (error) {

            console.error(
                "Asset scan error:",
                error
            );

            setScannerMessage(
                `Unable to find asset.<br>
                 <small>${escapeHtml(
                     error?.message || error
                 )}</small>`,
                "danger"
            );

            scanProcessing = false;
        }
    }

    // ============================================================
    // FIND ACTIVE REPAIR FOR ASSET
    // ============================================================

    async function findActiveRepair(asset) {

        if (!asset || !asset.id) {
            return null;
        }

        try {

            /*
             * Search using the Asset ID.
             */
            const searchValue =
                asset.asset_id ||
                asset.asset_tag ||
                asset.barcode ||
                "";

            if (!searchValue) {
                return null;
            }

            const response =
                await fetch(
                    `/api/repairs?search=${encodeURIComponent(
                        searchValue
                    )}`
                );

            if (!response.ok) {
                return null;
            }

            const data =
                await response.json();

            const records =
                Array.isArray(data)
                    ? data
                    : (
                        data.repairs ||
                        data.records ||
                        []
                    );

            if (!Array.isArray(records)) {
                return null;
            }

            /*
             * An active repair means the repair has NOT
             * been Returned.
             *
             * This allows:
             * For Repair
             * Repairing
             * Repaired
             * etc.
             *
             * to continue showing View Repair.
             */
            const activeRecords =
                records.filter(record => {

                    const recordAssetId =
                        Number(
                            record.asset_id
                        );

                    if (
                        recordAssetId !==
                        Number(asset.id)
                    ) {
                        return false;
                    }

                    const status =
                        String(
                            record.status || ""
                        )
                            .trim()
                            .toLowerCase();

                    return status !== "returned";

                });

            if (activeRecords.length === 0) {
                return null;
            }

            /*
             * Prefer the most recent repair.
             */
            activeRecords.sort(
                (a, b) => {

                    const dateA =
                        new Date(
                            a.created_at ||
                            a.date_reported ||
                            0
                        ).getTime();

                    const dateB =
                        new Date(
                            b.created_at ||
                            b.date_reported ||
                            0
                        ).getTime();

                    return dateB - dateA;
                }
            );

            return activeRecords[0];

        } catch (error) {

            console.warn(
                "Unable to check active repair:",
                error
            );

            return null;
        }
    }

    // ============================================================
    // OPEN ASSIGN MODAL FROM SCANNER
    // ============================================================

    async function openScannerAssignModal(
        asset
    ) {

        if (!asset || !asset.id) {
            return;
        }

        let modal =
            document.getElementById(
                "scannerAssignAssetModal"
            );

        if (modal) {

            const existing =
                bootstrap.Modal.getInstance(modal);

            existing?.show();

            return;
        }

        let employees = [];

        try {

            const response =
                await fetch(
                    "/api/employees?status=active"
                );

            const data =
                await response.json();

            employees =
                Array.isArray(data)
                    ? data
                    : (
                        data.employees ||
                        []
                    );

        } catch (error) {

            console.error(
                "Employee loading error:",
                error
            );

            alert(
                "Unable to load active employees."
            );

            return;
        }

        document.body.insertAdjacentHTML(
            "beforeend",
            `
            <div class="modal fade"
                 id="scannerAssignAssetModal"
                 tabindex="-1"
                 aria-hidden="true">

                <div class="modal-dialog modal-dialog-centered">

                    <div class="modal-content">

                        <div class="modal-header">

                            <h5 class="modal-title">
                                <i class="bi bi-person-check me-2"></i>
                                Assign Asset
                            </h5>

                            <button type="button"
                                    class="btn-close"
                                    data-bs-dismiss="modal">
                            </button>

                        </div>

                        <div class="modal-body">

                            <div class="alert alert-light border">

                                <div class="fw-semibold">
                                    Asset Tag
                                </div>

                                <div class="fs-5 text-primary">
                                    ${escapeHtml(
                                        asset.asset_id ||
                                        asset.asset_tag ||
                                        "-"
                                    )}
                                </div>

                                <div class="small text-muted">
                                    ${escapeHtml(
                                        asset.asset_name ||
                                        asset.name ||
                                        "-"
                                    )}
                                </div>

                            </div>

                            <div class="mb-3">

                                <label class="form-label fw-semibold">
                                    Employee
                                </label>

                                <input type="text"
                                       class="form-control"
                                       id="scannerEmployeeSearch"
                                       placeholder="Search employee...">

                                <input type="hidden"
                                       id="scannerAssignEmployee">

                                <div id="scannerEmployeePicker"
                                     class="border rounded mt-1"
                                     style="
                                         max-height:220px;
                                         overflow-y:auto;
                                         display:none;
                                     ">
                                </div>

                            </div>

                            <div class="mb-3">

                                <label class="form-label fw-semibold">
                                    Assignment Date
                                </label>

                                <input type="datetime-local"
                                       class="form-control"
                                       id="scannerAssignmentDate">

                            </div>

                            <div class="mb-3">

                                <label class="form-label fw-semibold">
                                    Remarks
                                </label>

                                <textarea
                                    class="form-control"
                                    id="scannerAssignmentRemarks"
                                    rows="3"
                                    placeholder="Optional remarks">
                                </textarea>

                            </div>

                            <div id="scannerAssignAlert"
                                 class="alert d-none">
                            </div>

                        </div>

                        <div class="modal-footer">

                            <button type="button"
                                    class="btn btn-secondary"
                                    data-bs-dismiss="modal">

                                Cancel

                            </button>

                            <button type="button"
                                    class="btn btn-primary"
                                    id="scannerAssignSubmitBtn">

                                <i class="bi bi-person-check me-1"></i>
                                Assign Asset

                            </button>

                        </div>

                    </div>

                </div>

            </div>
            `
        );

        modal =
            document.getElementById(
                "scannerAssignAssetModal"
            );

        const bootstrapModal =
            new bootstrap.Modal(modal);

        const search =
            document.getElementById(
                "scannerEmployeeSearch"
            );

        const employeeHidden =
            document.getElementById(
                "scannerAssignEmployee"
            );

        const picker =
            document.getElementById(
                "scannerEmployeePicker"
            );

        const dateInput =
            document.getElementById(
                "scannerAssignmentDate"
            );

        const remarksInput =
            document.getElementById(
                "scannerAssignmentRemarks"
            );

        const alertBox =
            document.getElementById(
                "scannerAssignAlert"
            );

        const submitButton =
            document.getElementById(
                "scannerAssignSubmitBtn"
            );

        function renderEmployees(
            filter = ""
        ) {

            const term =
                String(filter || "")
                    .trim()
                    .toLowerCase();

            const filtered =
                employees.filter(employee => {

                    const employeeId =
                        String(
                            employee.employee_id ||
                            ""
                        ).toLowerCase();

                    const name =
                        String(
                            employee.full_name ||
                            employee.name ||
                            ""
                        ).toLowerCase();

                    const department =
                        String(
                            employee.department_name ||
                            employee.department ||
                            ""
                        ).toLowerCase();

                    return (
                        !term ||
                        employeeId.includes(term) ||
                        name.includes(term) ||
                        department.includes(term)
                    );

                });

            if (filtered.length === 0) {

                picker.innerHTML = `
                    <div class="p-3 text-muted">
                        No active employee found.
                    </div>
                `;

                picker.style.display = "block";

                return;
            }

            picker.innerHTML =
                filtered.map(employee => {

                    return `
                        <button type="button"
                                class="list-group-item list-group-item-action scanner-employee-option"
                                data-id="${Number(
                                    employee.id
                                )}">

                            <div class="fw-semibold">
                                ${escapeHtml(
                                    employee.full_name ||
                                    employee.name ||
                                    "-"
                                )}
                            </div>

                            <div class="small text-muted">
                                ${escapeHtml(
                                    employee.employee_id ||
                                    "-"
                                )}
                                ${employee.department_name
                                    ? ` • ${escapeHtml(
                                        employee.department_name
                                      )}`
                                    : ""}
                            </div>

                        </button>
                    `;

                }).join("");

            picker.style.display = "block";

            picker
                .querySelectorAll(
                    ".scanner-employee-option"
                )
                .forEach(option => {

                    option.addEventListener(
                        "click",
                        function () {

                            const employeeId =
                                Number(
                                    this.dataset.id
                                );

                            const employee =
                                employees.find(
                                    item =>
                                        Number(
                                            item.id
                                        ) ===
                                        employeeId
                                );

                            if (!employee) {
                                return;
                            }

                            employeeHidden.value =
                                employee.id;

                            search.value =
                                employee.full_name ||
                                employee.name ||
                                "";

                            picker.style.display =
                                "none";
                        }
                    );

                });
        }

        search.addEventListener(
            "focus",
            () => renderEmployees(search.value)
        );

        search.addEventListener(
            "input",
            () => {

                employeeHidden.value = "";

                renderEmployees(
                    search.value
                );

            }
        );

        const now =
            new Date();

        now.setMinutes(
            now.getMinutes() -
            now.getTimezoneOffset()
        );

        dateInput.value =
            now.toISOString().slice(
                0,
                16
            );

        submitButton.addEventListener(
            "click",
            async function () {

                const employeeId =
                    Number(
                        employeeHidden.value
                    );

                if (!employeeId) {

                    alertBox.className =
                        "alert alert-warning";

                    alertBox.textContent =
                        "Please select an employee.";

                    return;
                }

                submitButton.disabled = true;

                submitButton.innerHTML = `
                    <span class="spinner-border spinner-border-sm me-1"></span>
                    Assigning...
                `;

                try {

                    const response =
                        await fetch(
                            "/api/assets/assign",
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({
                                        asset_ids: [
                                            Number(
                                                asset.id
                                            )
                                        ],

                                        employee_id:
                                            employeeId,

                                        assigned_at:
                                            dateInput.value,

                                        remarks:
                                            remarksInput.value
                                                .trim()
                                    })
                            }
                        );

                    const data =
                        await response.json();

                    if (!response.ok) {

                        throw new Error(
                            data.message ||
                            "Assignment failed."
                        );
                    }

                    alertBox.className =
                        "alert alert-success";

                    alertBox.textContent =
                        "Asset assigned successfully.";

                    setTimeout(
                        async () => {

                            bootstrapModal.hide();

                            /*
                             * Refresh the scanned
                             * Asset Details modal.
                             */
                            await showScannedAssetDetails(
                                asset
                            );

                        },
                        700
                    );

                } catch (error) {

                    console.error(
                        "Scanner assignment error:",
                        error
                    );

                    alertBox.className =
                        "alert alert-danger";

                    alertBox.textContent =
                        error.message ||
                        "Assignment failed.";

                } finally {

                    submitButton.disabled =
                        false;

                    submitButton.innerHTML = `
                        <i class="bi bi-person-check me-1"></i>
                        Assign Asset
                    `;
                }

            }
        );

        bootstrapModal.show();
    }

    // ============================================================
// SCANNER IMAGE VIEWER
// ============================================================

function showScannerImageViewer(
    imagePath,
    title = "Image"
) {

    if (!imagePath) {
        return;
    }

    const imageUrl =
        getScannerAssetImageUrl(
            imagePath
        );

    let modal =
        document.getElementById(
            "scannerImageViewerModal"
        );

    if (modal) {
        modal.remove();
    }

    document.body.insertAdjacentHTML(
        "beforeend",
        `
        <div
            class="modal fade"
            id="scannerImageViewerModal"
            tabindex="-1"
            aria-hidden="true"
        >

            <div
                class="modal-dialog modal-dialog-centered modal-xl"
            >

                <div class="modal-content">

                    <div class="modal-header">

                        <h5 class="modal-title">

                            <i class="bi bi-image me-2"></i>
                            ${escapeHtml(title)}

                        </h5>

                        <button
                            type="button"
                            class="btn-close"
                            data-bs-dismiss="modal"
                        ></button>

                    </div>

                    <div
                        class="modal-body text-center"
                        style="background:#f8f9fa;"
                    >

                        <img
                            src="${escapeHtml(imageUrl)}"
                            alt="${escapeHtml(title)}"
                            class="img-fluid rounded"
                            style="
                                max-height:75vh;
                                max-width:100%;
                                object-fit:contain;
                            "
                        >

                    </div>

                    <div class="modal-footer">

                        <button
                            type="button"
                            class="btn btn-secondary"
                            data-bs-dismiss="modal"
                        >

                            Close

                        </button>

                    </div>

                </div>

            </div>

        </div>
        `
    );

    modal =
        document.getElementById(
            "scannerImageViewerModal"
        );

    const imageModal =
        new bootstrap.Modal(modal);

    modal.addEventListener(
        "hidden.bs.modal",
        function () {

            modal.remove();

        },
        {
            once: true
        }
    );

    imageModal.show();
}

    // ============================================================
    // SHOW SCANNED ASSET DETAILS
    // ============================================================

    async function showScannedAssetDetails(
        asset
    ) {

        if (!asset || !asset.id) {
            return;
        }

        try {

            /*
             * Always reload the latest asset data.
             * This is important after assignment.
             */
            const response =
                await fetch(
                    `/api/assets/${asset.id}`
                );

            if (!response.ok) {
                throw new Error(
                    "Unable to load asset details."
                );
            }

            const data =
                await response.json();

            const fullAsset =
                data.asset ||
                data;

            /*
             * ----------------------------------------------------
             * CHECK ACTIVE MAINTENANCE RECORD
             * ----------------------------------------------------
             */

            const activeRepair =
                await findActiveRepair(
                    fullAsset
                );

            let modal =
                document.getElementById(
                    "scannedAssetDetailsModal"
                );

            if (modal) {
                modal.remove();
            }

            /*
             * ----------------------------------------------------
             * REPAIR BUTTON
             * ----------------------------------------------------
             */

            let repairButtonHtml;

            if (activeRepair) {

                repairButtonHtml = `
                    <button type="button"
                            class="btn btn-outline-primary"
                            id="scannedAssetRepairBtn">

                        <i class="bi bi-eye me-1"></i>
                        View Repair

                    </button>
                `;

            } else {

                repairButtonHtml = `
                    <button type="button"
                            class="btn btn-warning"
                            id="scannedAssetRepairBtn">

                        <i class="bi bi-tools me-1"></i>
                        For Repair

                    </button>
                `;
            }

            /*
             * ----------------------------------------------------
             * DETAILS MODAL
             * ----------------------------------------------------
             */

            document.body.insertAdjacentHTML(
                "beforeend",
                `
                <div class="modal fade"
                     id="scannedAssetDetailsModal"
                     tabindex="-1"
                     aria-hidden="true">

                    <div class="modal-dialog modal-dialog-centered modal-lg">

                        <div class="modal-content">

                            <div class="modal-header">

                                <h5 class="modal-title">

                                    <i class="bi bi-pc-display me-2"></i>
                                    Asset Details

                                </h5>

                                <button type="button"
                                        class="btn-close"
                                        data-bs-dismiss="modal">
                                </button>

                            </div>

                            <div class="modal-body">

                                ${
                                    activeRepair
                                        ? `
                                            <div class="alert alert-warning d-flex align-items-center">

                                                <i class="bi bi-tools fs-4 me-2"></i>

                                                <div>
                                                    <div class="fw-semibold">
                                                        Asset is currently in Maintenance
                                                    </div>

                                                    <div class="small">
                                                        Repair No:
                                                        <strong>
                                                            ${escapeHtml(
                                                                activeRepair.repair_no ||
                                                                activeRepair.repair_number ||
                                                                "-"
                                                            )}
                                                        </strong>

                                                        ${
                                                            activeRepair.status
                                                                ? ` • Status: <strong>${escapeHtml(
                                                                    activeRepair.status
                                                                  )}</strong>`
                                                                : ""
                                                        }
                                                    </div>
                                                </div>

                                            </div>
                                          `
                                        : ""
                                }
                                <!-- ========================================================
     ASSET IMAGES
========================================================= -->

<div class="row g-3 mb-3">

    <!-- ASSET IMAGE -->

    <div class="col-md-6">

        <div class="card h-100">

            <div class="card-header fw-semibold">

                <i class="bi bi-image me-2"></i>
                Asset Image

            </div>

            <div class="card-body text-center">

                ${
                    fullAsset.asset_image
                        ? `
                            <div class="mb-3">

                                <img
                                    src="${escapeHtml(
                                        getScannerAssetImageUrl(
                                            fullAsset.asset_image
                                        )
                                    )}"
                                    alt="Asset Image"
                                    class="img-fluid rounded border"
                                    style="
                                        max-height:220px;
                                        width:100%;
                                        object-fit:contain;
                                        cursor:pointer;
                                    "
                                    id="scannedAssetImage"
                                    onerror="
                                        this.style.display='none';
                                        document.getElementById('scannedAssetImageError')?.classList.remove('d-none');
                                    "
                                >

                                <div
                                    id="scannedAssetImageError"
                                    class="text-muted py-4 d-none"
                                >
                                    <i class="bi bi-image fs-1 d-block mb-2"></i>
                                    Unable to load image.
                                </div>

                            </div>

                            <button
                                type="button"
                                class="btn btn-outline-primary btn-sm"
                                id="scannedViewAssetImageBtn"
                            >

                                <i class="bi bi-arrows-fullscreen me-1"></i>
                                View Image

                            </button>
                          `
                        : `
                            <div class="text-muted py-4">

                                <i class="bi bi-image fs-1 d-block mb-2"></i>

                                No asset image

                            </div>
                          `
                }

            </div>

        </div>

    </div>


    <!-- RECEIPT IMAGE -->

    <div class="col-md-6">

        <div class="card h-100">

            <div class="card-header fw-semibold">

                <i class="bi bi-receipt me-2"></i>
                Receipt

            </div>

            <div class="card-body text-center">

                ${
                    fullAsset.receipt_image
                        ? `
                            <div class="mb-3">

                                <img
                                    src="${escapeHtml(
                                        getScannerAssetImageUrl(
                                            fullAsset.receipt_image
                                        )
                                    )}"
                                    alt="Receipt"
                                    class="img-fluid rounded border"
                                    style="
                                        max-height:220px;
                                        width:100%;
                                        object-fit:contain;
                                        cursor:pointer;
                                    "
                                    id="scannedReceiptImage"
                                    onerror="
                                        this.style.display='none';
                                        document.getElementById('scannedReceiptImageError')?.classList.remove('d-none');
                                    "
                                >

                                <div
                                    id="scannedReceiptImageError"
                                    class="text-muted py-4 d-none"
                                >
                                    Unable to load receipt image.
                                </div>

                            </div>

                            <button
                                type="button"
                                class="btn btn-outline-primary btn-sm"
                                id="scannedViewReceiptImageBtn"
                            >

                                <i class="bi bi-arrows-fullscreen me-1"></i>
                                View Receipt

                            </button>
                          `
                        : `
                            <div class="text-muted py-4">

                                <i class="bi bi-receipt fs-1 d-block mb-2"></i>

                                No receipt image

                            </div>
                          `
                }

            </div>

        </div>

    </div>

</div>

                                <div class="row g-3">

                                    <div class="col-md-6">

                                        <div class="card h-100">

                                            <div class="card-header fw-semibold">
                                                Asset Information
                                            </div>

                                            <div class="card-body">

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Asset Tag
                                                    </small>

                                                    <div class="fw-bold fs-5 text-primary">
                                                        ${escapeHtml(
                                                            fullAsset.asset_id ||
                                                            fullAsset.asset_tag ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Asset Name
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.asset_name ||
                                                            fullAsset.name ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Status
                                                    </small>

                                                    <div>
                                                        ${scannerStatusBadge(
                                                            fullAsset.status
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Category
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.category_name ||
                                                            fullAsset.category ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Brand / Model
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            [
                                                                fullAsset.brand,
                                                                fullAsset.model
                                                            ]
                                                                .filter(Boolean)
                                                                .join(" / ") ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Serial Number
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.serial_number ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Barcode
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.barcode ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                            </div>

                                        </div>

                                    </div>

                                    <div class="col-md-6">

                                        <div class="card h-100">

                                            <div class="card-header fw-semibold">
                                                Assignment / Location
                                            </div>

                                            <div class="card-body">

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Custodian
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.employee_name ||
                                                            fullAsset.custodian_name ||
                                                            fullAsset.custodian ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Employee ID
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.employee_id ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Department
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.department_name ||
                                                            fullAsset.department ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Location
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.location_name ||
                                                            fullAsset.location ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Condition
                                                    </small>

                                                    <div>
                                                        ${escapeHtml(
                                                            fullAsset.condition_status ||
                                                            fullAsset.condition ||
                                                            "-"
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Purchase Date
                                                    </small>

                                                    <div>
                                                        ${formatDate(
                                                            fullAsset.purchase_date
                                                        )}
                                                    </div>
                                                </div>

                                                <div class="mb-2">
                                                    <small class="text-muted">
                                                        Warranty Expiry
                                                    </small>

                                                    <div>
                                                        ${formatDate(
                                                            fullAsset.warranty_expiry
                                                        )}
                                                    </div>
                                                </div>

                                            </div>

                                        </div>

                                    </div>

                                    ${
                                        fullAsset.notes
                                            ? `
                                                <div class="col-12">

                                                    <div class="card">

                                                        <div class="card-header fw-semibold">
                                                            Notes
                                                        </div>

                                                        <div class="card-body">
                                                            ${escapeHtml(
                                                                fullAsset.notes
                                                            )}
                                                        </div>

                                                    </div>

                                                </div>
                                              `
                                            : ""
                                    }

                                </div>

                            </div>

                            <div class="modal-footer">

                                <button type="button"
                                        class="btn btn-outline-primary"
                                        id="scannedAssetHistoryBtn">

                                    <i class="bi bi-clock-history me-1"></i>
                                    Asset History

                                </button>

                                <button type="button"
                                        class="btn btn-primary"
                                        id="scannedAssetAssignBtn">

                                    <i class="bi bi-person-check me-1"></i>
                                    Assign

                                </button>

                                ${repairButtonHtml}

                                <button type="button"
                                        class="btn btn-secondary"
                                        data-bs-dismiss="modal">

                                    Close

                                </button>

                            </div>

                        </div>

                    </div>

                </div>
                `
            );

            modal =
                document.getElementById(
                    "scannedAssetDetailsModal"
                );

            const detailsModal =
                new bootstrap.Modal(modal);
                // ============================================================
// VIEW ASSET IMAGE
// ============================================================

document
    .getElementById(
        "scannedViewAssetImageBtn"
    )
    ?.addEventListener(
        "click",
        function () {

            if (!fullAsset.asset_image) {
                return;
            }

            showScannerImageViewer(
                fullAsset.asset_image,
                "Asset Image"
            );

        }
    );


// ============================================================
// VIEW RECEIPT IMAGE
// ============================================================

document
    .getElementById(
        "scannedViewReceiptImageBtn"
    )
    ?.addEventListener(
        "click",
        function () {

            if (!fullAsset.receipt_image) {
                return;
            }

            showScannerImageViewer(
                fullAsset.receipt_image,
                "Receipt Image"
            );

        }
    );


// ============================================================
// CLICK THUMBNAIL TO VIEW
// ============================================================

document
    .getElementById(
        "scannedAssetImage"
    )
    ?.addEventListener(
        "click",
        function () {

            if (!fullAsset.asset_image) {
                return;
            }

            showScannerImageViewer(
                fullAsset.asset_image,
                "Asset Image"
            );

        }
    );


document
    .getElementById(
        "scannedReceiptImage"
    )
    ?.addEventListener(
        "click",
        function () {

            if (!fullAsset.receipt_image) {
                return;
            }

            showScannerImageViewer(
                fullAsset.receipt_image,
                "Receipt Image"
            );

        }
    );

            /*
             * ----------------------------------------------------
             * ASSET HISTORY
             * ----------------------------------------------------
             */

            document
                .getElementById(
                    "scannedAssetHistoryBtn"
                )
                ?.addEventListener(
                    "click",
                    async function () {

                        detailsModal.hide();

                        setTimeout(
                            async () => {

                                await showAssetHistory(
                                    fullAsset
                                );

                            },
                            300
                        );

                    }
                );

            /*
             * ----------------------------------------------------
             * ASSIGN
             * ----------------------------------------------------
             */

            document
                .getElementById(
                    "scannedAssetAssignBtn"
                )
                ?.addEventListener(
                    "click",
                    async function () {

                        detailsModal.hide();

                        setTimeout(
                            async () => {

                                await openScannerAssignModal(
                                    fullAsset
                                );

                            },
                            300
                        );

                    }
                );

            /*
             * ----------------------------------------------------
             * REPAIR / VIEW REPAIR
             * ----------------------------------------------------
             */

            document
                .getElementById(
                    "scannedAssetRepairBtn"
                )
                ?.addEventListener(
                    "click",
                    async function () {

                        /*
                         * If an active repair exists,
                         * open the SAME Maintenance View modal
                         * by using maintenance.js URL handling.
                         */
                        if (activeRepair) {

                            detailsModal.hide();

                            setTimeout(
                                () => {

                                    window.location.href =
                                        `/maintenance?repair_id=${encodeURIComponent(
                                            activeRepair.id
                                        )}`;

                                },
                                200
                            );

                            return;
                        }

                        /*
                         * Otherwise create a new repair.
                         */
                        detailsModal.hide();

                        setTimeout(
                            () => {

                                window.location.href =
                                    `/maintenance?asset_id=${encodeURIComponent(
                                        fullAsset.id
                                    )}&report=1`;

                            },
                            200
                        );

                    }
                );

            /*
             * Remove modal from DOM after closing.
             */
            modal.addEventListener(
                "hidden.bs.modal",
                function () {
                    modal.remove();
                },
                {
                    once: true
                }
            );

            detailsModal.show();

        } catch (error) {

            console.error(
                "Show scanned asset details error:",
                error
            );

            alert(
                error.message ||
                "Unable to display asset details."
            );
        }
    }

    // ============================================================
    // ASSET HISTORY
    // ============================================================

    async function showAssetHistory(
        asset
    ) {

        if (!asset || !asset.id) {
            return;
        }

        try {

            const response =
                await fetch(
                    `/api/assets/${asset.id}/history`
                );

            if (!response.ok) {
                throw new Error(
                    "Unable to load asset history."
                );
            }

            const data =
                await response.json();

            const history =
                Array.isArray(data)
                    ? data
                    : (
                        data.history ||
                        []
                    );

            let modal =
                document.getElementById(
                    "scannedAssetHistoryModal"
                );

            if (modal) {
                modal.remove();
            }

            const rows =
                history.length
                    ? history.map(item => {

                        return `
                            <tr>

                                <td>
                                    ${escapeHtml(
                                        formatDate(
                                            item.created_at ||
                                            item.date ||
                                            item.timestamp
                                        )
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        item.action ||
                                        item.event ||
                                        "-"
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        item.description ||
                                        item.remarks ||
                                        item.notes ||
                                        "-"
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        item.performed_by_name ||
                                        item.user_name ||
                                        item.performed_by ||
                                        "-"
                                    )}
                                </td>

                            </tr>
                        `;

                    }).join("")
                    : `
                        <tr>
                            <td colspan="4"
                                class="text-center text-muted py-4">
                                No asset history found.
                            </td>
                        </tr>
                    `;

            document.body.insertAdjacentHTML(
                "beforeend",
                `
                <div class="modal fade"
                     id="scannedAssetHistoryModal"
                     tabindex="-1"
                     aria-hidden="true">

                    <div class="modal-dialog modal-dialog-centered modal-xl">

                        <div class="modal-content">

                            <div class="modal-header">

                                <h5 class="modal-title">

                                    <i class="bi bi-clock-history me-2"></i>
                                    Asset History

                                </h5>

                                <button type="button"
                                        class="btn-close"
                                        data-bs-dismiss="modal">
                                </button>

                            </div>

                            <div class="modal-body">

                                <div class="mb-3">

                                    <div class="small text-muted">
                                        Asset Tag
                                    </div>

                                    <div class="fw-bold fs-5 text-primary">
                                        ${escapeHtml(
                                            asset.asset_id ||
                                            asset.asset_tag ||
                                            "-"
                                        )}
                                    </div>

                                </div>

                                <div class="table-responsive">

                                    <table class="table table-bordered table-hover align-middle">

                                        <thead class="table-light">

                                            <tr>
                                                <th>Date</th>
                                                <th>Action</th>
                                                <th>Description / Remarks</th>
                                                <th>Performed By</th>
                                            </tr>

                                        </thead>

                                        <tbody>
                                            ${rows}
                                        </tbody>

                                    </table>

                                </div>

                            </div>

                            <div class="modal-footer">

                                <button type="button"
                                        class="btn btn-secondary"
                                        data-bs-dismiss="modal">

                                    Close

                                </button>

                            </div>

                        </div>

                    </div>

                </div>
                `
            );

            modal =
                document.getElementById(
                    "scannedAssetHistoryModal"
                );

            const historyModal =
                new bootstrap.Modal(modal);

            modal.addEventListener(
                "hidden.bs.modal",
                function () {
                    modal.remove();
                },
                {
                    once: true
                }
            );

            historyModal.show();

        } catch (error) {

            console.error(
                "Asset history error:",
                error
            );

            alert(
                error.message ||
                "Unable to load asset history."
            );
        }
    }

    // ============================================================
    // INITIALIZE
    // ============================================================

    function initializeScanner() {

        if (!window.bootstrap) {

            console.warn(
                "PRIMA Scanner: Bootstrap is not loaded yet."
            );

            return;
        }

        ensureScannerModal();

        setupAssetScanner();

        connectAssetScanButton();

        console.log(
            "PRIMA Asset Scanner initialized."
        );
    }

    // ============================================================
    // DOM READY
    // ============================================================

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initializeScanner
        );

    } else {

        initializeScanner();

    }

})();
