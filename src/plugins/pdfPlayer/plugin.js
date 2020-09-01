import connectionManager from 'connectionManager';
import loading from 'loading';
import keyboardnavigation from 'keyboardnavigation';
import dialogHelper from 'dialogHelper';
import dom from 'dom';
import appRouter from 'appRouter';
import events from 'events';
import 'css!./style';
import 'material-icons';
import 'paper-icon-button-light';

export class PdfPlayer {
    constructor() {
        this.name = 'PDF Player';
        this.type = 'mediaplayer';
        this.id = 'pdfplayer';
        this.priority = 1;

        this.onDialogClosed = this.onDialogClosed.bind(this);
        this.onWindowKeyUp = this.onWindowKeyUp.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
    }

    play(options) {
        this.progress = 0;
        this.loaded = false;
        this.cancellationToken = false;
        this.pages = {};

        loading.show();

        let elem = this.createMediaElement();
        return this.setCurrentSrc(elem, options);
    }

    stop() {
        this.unbindEvents();

        let elem = this.mediaElement;
        if (elem) {
            dialogHelper.close(elem);
            this.mediaElement = null;
        }

        // hide loading animation
        loading.hide();

        // cancel page render
        this.cancellationToken = true;
    }

    currentItem() {
        return this.item;
    }

    currentTime() {
        return this.progress;
    }

    duration() {
        return this.book ? this.book.numPages : 0;
    }

    volume() {
        return 100;
    }

    isMuted() {
        return false;
    }

    paused() {
        return false;
    }

    seekable() {
        return true;
    }

    onWindowKeyUp(e) {
        let key = keyboardnavigation.getKeyName(e);

        if (!this.loaded) return;
        switch (key) {
            case 'l':
            case 'ArrowRight':
            case 'Right':
                this.next();
                break;
            case 'j':
            case 'ArrowLeft':
            case 'Left':
                this.previous();
                break;
            case 'Escape':
                this.stop();
                break;
        }
    }

    onTouchStart(e) {
        if (!this.loaded || !e.touches || e.touches.length === 0) return;
        if (e.touches[0].clientX < dom.getWindowSize().innerWidth / 2) {
            this.previous();
        } else {
            this.next();
        }
    }

    onDialogClosed() {
        this.stop();
    }

    bindMediaElementEvents() {
        let elem = this.mediaElement;

        elem.addEventListener('close', this.onDialogClosed, {once: true});
        elem.querySelector('.btnExit').addEventListener('click', this.onDialogClosed, {once: true});
    }

    bindEvents() {
        this.bindMediaElementEvents();

        document.addEventListener('keyup', this.onWindowKeyUp);
        document.addEventListener('touchstart', this.onTouchStart);
    }

    unbindMediaElementEvents() {
        let elem = this.mediaElement;

        elem.removeEventListener('close', this.onDialogClosed);
        elem.querySelector('.btnExit').removeEventListener('click', this.onDialogClosed);
    }

    unbindEvents() {
        if (this.mediaElement) {
            this.unbindMediaElementEvents();
        }

        document.removeEventListener('keyup', this.onWindowKeyUp);
        document.removeEventListener('touchstart', this.onTouchStart);
    }

    createMediaElement() {
        let elem = this.mediaElement;
        if (elem) {
            return elem;
        }

        elem = document.getElementById('pdfPlayer');
        if (!elem) {
            elem = dialogHelper.createDialog({
                exitAnimationDuration: 400,
                size: 'fullscreen',
                autoFocus: false,
                scrollY: false,
                exitAnimation: 'fadeout',
                removeOnClose: true
            });

            let html = '';
            html += '<canvas id="canvas"></canvas>';
            html += '<div class="actionButtons">';
            html += '<button is="paper-icon-button-light" class="autoSize btnExit" tabindex="-1"><i class="material-icons actionButtonIcon close"></i></button>';
            html += '</div>';

            elem.id = 'pdfPlayer';
            elem.innerHTML = html;

            dialogHelper.open(elem);
        }

        this.mediaElement = elem;
        return elem;
    }

    setCurrentSrc(elem, options) {
        let item = options.items[0];

        this.item = item;
        this.streamInfo = {
            started: true,
            ended: false,
            mediaSource: {
                Id: item.Id
            }
        };

        let serverId = item.ServerId;
        let apiClient = connectionManager.getApiClient(serverId);

        return new Promise((resolve, reject) => {
            import('pdfjs').then(({default: pdfjs}) => {
                let downloadHref = apiClient.getItemDownloadUrl(item.Id);

                this.bindEvents();
                pdfjs.GlobalWorkerOptions.workerSrc = appRouter.baseUrl() + '/libraries/pdf.worker.js';

                let downloadTask = pdfjs.getDocument(downloadHref);
                downloadTask.promise.then(book => {
                    if (this.cancellationToken) return;
                    this.book = book;
                    this.loaded = true;

                    const percentageTicks = options.startPositionTicks / 10000;
                    if (percentageTicks !== 0) {
                        this.loadPage(percentageTicks);
                        this.progress = percentageTicks;
                    } else {
                        this.loadPage(1);
                    }

                    return resolve();
                });
            });
        });
    }

    next() {
        if (this.progress === this.duration() - 1) return;
        this.loadPage(this.progress + 2);
        this.progress = this.progress + 1;
    }

    previous() {
        if (this.progress === 0) return;
        this.loadPage(this.progress);
        this.progress = this.progress - 1;
    }

    replaceCanvas(canvas) {
        const old = document.getElementById('canvas');

        canvas.id = 'canvas';
        old.parentNode.replaceChild(canvas, old);
    }

    loadPage(number) {
        const prefix = 'page';
        const pad = 2;

        // generate list of cached pages by padding the requested page on both sides
        let pages = [prefix + number];
        for (let i = 1; i <= pad; i++) {
            if (number - i > 0) pages.push(prefix + (number - i));
            if (number + i < this.duration()) pages.push(prefix + (number + i));
        }

        // load any missing pages in the cache
        for (let page of pages) {
            if (!this.pages[page]) {
                this.pages[page] = document.createElement('canvas');
                this.renderPage(this.pages[page], parseInt(page.substr(4)));
            }
        }

        // show the requested page
        this.replaceCanvas(this.pages[prefix + number], number);

        // delete all pages outside the cache area
        for (let page in this.pages) {
            if (!pages.includes(page)) {
                delete this.pages[page];
            }
        }
    }

    renderPage(canvas, number) {
        this.book.getPage(number).then(page => {
            events.trigger(this, 'timeupdate');

            const original = page.getViewport({ scale: 1 });
            const context = canvas.getContext('2d');

            const widthRatio = dom.getWindowSize().innerWidth / original.width;
            const heightRatio = dom.getWindowSize().innerHeight / original.height;
            const scale = Math.min(heightRatio, widthRatio);
            const viewport = page.getViewport({ scale: scale });

            canvas.width = viewport.width;
            canvas.height = viewport.height;
            var renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            let renderTask = page.render(renderContext);
            renderTask.promise.then(() => {
                loading.hide();
            });
        });
    }

    canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'book';
    }

    canPlayItem(item) {
        if (item.Path && item.Path.endsWith('pdf')) {
            return true;
        }

        return false;
    }
}

export default PdfPlayer;
