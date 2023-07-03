/**
 * 読み込んだファイルハンドル
 * @type {FileSystemFileHandle}
 */
let fileHandle;
/**
 * データベースのテーブルデータ
 * @type {{key: string, value: string}}
 */
let dbDict;
/**
 * データベースのテーブルキーを表示する親要素
 * @type {Element}
 */
let dbKeysElement;
/**
 * データベースの編集中のキー要素
 * @type {Element}
 */
let activeDbElement;
/**
 * データベース
 * @type {SQL.Database}
 */
let db;
/**
 * データベース
 * @type {SQL.Database}
 */
let editor;

window.addEventListener('load', loadedPage);
function loadedPage() {
    initEditor();
    dbKeysElement = document.getElementById('db-keys');

    eventHooks();
}

/**
 * エディタ初期化
 */
function initEditor() {
    editor = ace.edit("editor");
    editor.setTheme("ace/theme/twilight");
    updateEditorLanguageHighlight(false);
}

/**
 * イベントフック
 */
function eventHooks() {
    /**
     * ドラッグ
     */
    $(document).on('dragover', '#editor', function (_e) {
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
    $(document).on('drop', '#editor', async function (_e) {
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
            fileHandle = item.getAsFileSystemHandle();
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
        activeDbElement = _e.currentTarget;
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
    db = null;
    dbDict = {};
    dbKeysElement.innerHTML = '';
    activeDbElement = null;
    editor.setValue('');
}

/**
 * データベースロード
 * @param {ProgressEvent<FileReader>} e 
 */
function loadDb(e) {
    initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` }).then(function (SQL) {
        const uint8 = new Uint8Array(e.target.result);
        db = new SQL.Database(uint8);
        const contents = db.exec("SELECT * FROM Entity;");

        if (contents.length == 0) { return; }

        for (const pair of contents[0].values) {
            const key = pair[0];
            const value = pair[1];
            dbDict[key] = value;

            const element = document.createElement('div');
            element.className = 'db-key';
            element.dataset.key = key;

            element.innerText = key;
            dbKeysElement.appendChild(element);
        }
    });
}

/**
 * 編集中の値を一時保存
 */
function storeCurrentEditor() {
    const isReseted = activeDbElement == null;
    if (isReseted) { return; }

    const isClean = editor.session.getUndoManager().isClean();
    if (isClean) { return; }

    const value = editor.getValue();
    const isJson = isJsonText(value)
    // jsonの場合は改行等を削除
    const text = isJson ? JSON.stringify(JSON.parse(value)) : value;
    const key = activeDbElement.dataset.key;
    dbDict[key] = text;
}

/**
 * 選択したKeyの値をエディタに表示
 * @param {string} key 
 */
function showSelectedValue(key) {
    const value = dbDict[key];

    const isJson = isJsonText(value);
    updateEditorLanguageHighlight(isJson);

    const text = isJson ? JSON.stringify(JSON.parse(value), null, 4) : value;
    editor.setValue(text);
}

/**
 * アクティブなキーを変更
 * @param {Element} selectElement 
 */
function switchActiveKeyElement(selectElement) {
    if (activeDbElement != null) { activeDbElement.classList.remove('active'); }
    selectElement.classList.add('active');
}

/**
 * データベースを保存
 */
async function saveDb() {
    if (fileHandle == null) {
        showToastr('warning', 'ファイルが開かれていません。', null);
        return;
    }

    storeCurrentEditor();
    try {
        for (const key in dbDict) {
            const value = dbDict[key];
            db.run(`UPDATE Entity SET value = '${value}' WHERE id = '${key}';`)
        }
        const binary = db.export();

        const handle = await fileHandle;
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
        editor.session.setMode(new jsonMode());
    } else {
        const plainMode = ace.require("ace/mode/plain_text").Mode;
        editor.session.setMode(new plainMode());
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