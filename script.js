/**
 * 読み込んだファイルハンドル
 * @type {FileSystemFileHandle}
 */
let _fileHandle;
/**
 * データベースのテーブルデータ
 * @type {{key: string, value: string}}
 */
let _dbRecords;
/**
 * データベースのテーブルキーを表示する親要素
 * @type {Element}
 */
let _dbKeysElement;
/**
 * データベースの編集中のキー要素
 * @type {Element}
 */
let _activeDbElement;
/**
 * データベース
 * @type {SQL.Database}
 */
let _db;
/**
 * データベース
 * @type {SQL.Database}
 */
let _editor;

window.addEventListener('load', loadedPage);
function loadedPage() {
    initEditor();
    _dbKeysElement = document.getElementById('db-keys');

    eventHooks();
}

/**
 * エディタ初期化
 */
function initEditor() {
    _editor = ace.edit("editor");
    _editor.setTheme("ace/theme/twilight");
    updateEditorLanguageHighlight(false);
}

/**
 * イベントフック
 */
function eventHooks() {
    /**
     * ドラッグ
     */
    $(document).on('dragover', '#db-keys, #editor', function (_e) {
        var e = _e;
        if (_e.originalEvent) {
            e = _e.originalEvent;
        }
        e.stopPropagation();
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    /**
     * ドラック&ドロップでファイルを読み込み
     */
    $(document).on('drop', '#db-keys, #editor', async function (_e) {
        var e = _e;
        if (_e.originalEvent) {
            e = _e.originalEvent;
        }
        e.stopPropagation();
        e.preventDefault();

        initSession();

        var items = e.dataTransfer.items;
        for (var i = 0; i < items.length; i++) {
            let item = items[i];
            if (item.kind != 'file') { continue; }
            _fileHandle = item.getAsFileSystemHandle();
            let file = item.getAsFile();
            if (!file.name.endsWith('db')) { continue; }

            // ocsのみ読み込み
            var reader = new FileReader();
            reader.onload = (function (loadFile) {
                return function (e) { loadDb(e); };
            })(file);

            reader.readAsArrayBuffer(file);
            $('#filename').text(file.name);
            break;
        }
    });

    /**
     * key切り替え
     */
    $(document).on('click', '.db-key', async function (_e) {
        // 現在のvalueを保持
        storeCurrentEditor();

        const key = _e.currentTarget.dataset.key;
        showSelectedValue(key);

        switchActiveKeyElement(_e.currentTarget);
        _activeDbElement = _e.currentTarget;
    });

    /**
     * キーイベント
     */
    $(window).bind('keydown', async function (e) {
        if (e.ctrlKey || e.metaKey) {
            switch (String.fromCharCode(e.which).toLowerCase()) {
                case 's':
                    e.preventDefault();
                    await saveDb();
                    break;
            }
        }
    });
}

/**
 * 初期化
 */
function initSession() {
    _db = null;
    _dbRecords = {};
    _dbKeysElement.innerHTML = '';
    _activeDbElement = null;
    _editor.setValue('');
}

/**
 * データベースロード
 * @param {ProgressEvent<FileReader>} e 
 */
function loadDb(e) {
    initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` }).then(function (SQL) {
        const uint8 = new Uint8Array(e.target.result);
        _db = new SQL.Database(uint8);
        const contents = _db.exec("SELECT * FROM Entity;");

        if (contents.length == 0) { return; }

        for (const pair of contents[0].values) {
            const key = pair[0];
            const value = pair[1];
            _dbRecords[key] = value;

            const element = document.createElement('div');
            element.className = 'db-key';
            element.dataset.key = key;

            element.innerText = key;
            _dbKeysElement.appendChild(element);
        }
    });
}

/**
 * 編集中の値を一時保存
 */
function storeCurrentEditor() {
    const isReseted = _activeDbElement == null;
    if (isReseted) { return; }

    const isClean = _editor.session.getUndoManager().isClean();
    if (isClean) { return; }

    const value = _editor.getValue();
    const isJson = isJsonText(value)
    // jsonの場合は改行等を削除
    const text = isJson ? JSON.stringify(JSON.parse(value)) : value;
    const key = _activeDbElement.dataset.key;
    _dbRecords[key] = text;
}

/**
 * 選択したKeyの値をエディタに表示
 * @param {string} key 
 */
function showSelectedValue(key) {
    const value = _dbRecords[key];

    const isJson = isJsonText(value);
    updateEditorLanguageHighlight(isJson);

    const text = isJson ? JSON.stringify(JSON.parse(value), null, 4) : value;
    _editor.setValue(text);
}

/**
 * アクティブなキーを変更
 * @param {Element} selectElement 
 */
function switchActiveKeyElement(selectElement) {
    if (_activeDbElement != null) { _activeDbElement.classList.remove('active'); }
    selectElement.classList.add('active');
}

/**
 * データベースを保存
 */
async function saveDb() {
    if (_fileHandle == null) {
        showToastr('warning', 'ファイルが開かれていません。', null);
        return;
    }

    storeCurrentEditor();
    try {
        for (const key in _dbRecords) {
            const value = _dbRecords[key];
            _db.run(`UPDATE Entity SET value = '${value}' WHERE id = '${key}';`)
        }
        const binary = _db.export();

        const handle = await _fileHandle;
        const writer = await handle.createWritable();
        await writer.write(binary);
        await writer.close();

        showToastr('success', 'ファイルを保存しました。', null);
    } catch (error) {
        showToastr('error', 'ファイルの保存に失敗しました。', error);
    }
}

/**
 * エディタのハイライトモードを更新
 * @param {bool} toJsonMode Jsonモードに変更するか
 */
function updateEditorLanguageHighlight(toJsonMode) {
    if (toJsonMode) {
        const jsonMode = ace.require("ace/mode/json").Mode;
        _editor.session.setMode(new jsonMode());
    } else {
        const plainMode = ace.require("ace/mode/plain_text").Mode;
        _editor.session.setMode(new plainMode());
    }
}

/**
 * Json形式か
 * @param {string} text 
 */
function isJsonText(text) {
    try {
        JSON.parse(text);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * トースト通知
 * @param {string} status success, info, warning, error
 * @param {string} title 
 * @param {string} message 
 */
function showToastr(status, title, message) {
    if (['success', 'info', 'warning', 'error'].indexOf(status) < 0) {
        console.log(`不明なstatus: ${status}`);
        return;
    }

    Command: toastr[status](message, title);
    toastr.options = {
        "closeButton": true,
        "debug": false,
        "newestOnTop": false,
        "progressBar": false,
        "positionClass": "toast-top-right",
        "preventDuplicates": false,
        "onclick": null,
        "showDuration": "300",
        "hideDuration": "1000",
        "timeOut": "5000",
        "extendedTimeOut": "1000",
        "showEasing": "swing",
        "hideEasing": "linear",
        "showMethod": "fadeIn",
        "hideMethod": "fadeOut"
    }
}