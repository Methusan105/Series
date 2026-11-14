class AcceleratedDownloader {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 1024 * 1024;
    this.maxConcurrent = options.maxConcurrent || 6;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    
    this.aborted = false;
    this.downloadedChunks = new Map();
    this.totalSize = 0;
    this.downloadedSize = 0;
    this.corsProxy = options.corsProxy || 'https://cors-anywhere.herokuapp.com/';
    this.useProxy = options.useProxy !== false;
  }

  _getProxyUrl(url) {
    if (!this.useProxy) return url;
    // GitHub releases often allow CORS directly
    if (url.includes('github.com') && url.includes('/releases/download/')) {
      return url;
    }
    return url;
  }

  async download(url, videoElement) {
    this.aborted = false;
    const proxiedUrl = this._getProxyUrl(url);
    
    try {
      const headResponse = await fetch(proxiedUrl, { method: 'HEAD' });
      if (!headResponse.ok) throw new Error(`HEAD request failed: ${headResponse.status}`);
      
      const contentLength = headResponse.headers.get('content-length');
      if (!contentLength) throw new Error('Content-Length header missing');
      
      this.totalSize = parseInt(contentLength, 10);
      const supportsRange = headResponse.headers.get('accept-ranges') === 'bytes';
      
      if (!supportsRange) {
        return this.fallbackDownload(proxiedUrl, videoElement);
      }

      const chunks = this.calculateChunks(this.totalSize);
      await this.downloadChunksParallel(proxiedUrl, chunks, videoElement);
      
      if (!this.aborted) {
        const blob = this.assembleBlob();
        const blobUrl = URL.createObjectURL(blob);
        videoElement.src = blobUrl;
        this.onComplete(blobUrl);
      }
    } catch (error) {
      if (!this.aborted) this.onError(error);
    }
  }

  calculateChunks(totalSize) {
    const chunks = [];
    for (let start = 0; start < totalSize; start += this.chunkSize) {
      const end = Math.min(start + this.chunkSize - 1, totalSize - 1);
      chunks.push({ start, end, size: end - start + 1 });
    }
    return chunks;
  }

  async downloadChunksParallel(url, chunks, videoElement) {
    const queue = [...chunks];
    const workers = Array(this.maxConcurrent).fill(null).map(() => this.worker(queue, url));
    await Promise.all(workers);
  }

  async worker(queue, url) {
    while (queue.length > 0 && !this.aborted) {
      const chunk = queue.shift();
      if (!chunk) break;
      
      try {
        const data = await this.downloadChunk(url, chunk.start, chunk.end);
        this.downloadedChunks.set(chunk.start, data);
        this.downloadedSize += data.byteLength;
        this.onProgress(this.downloadedSize, this.totalSize);
      } catch (error) {
        if (!this.aborted) {
          queue.unshift(chunk);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  async downloadChunk(url, start, end) {
    const response = await fetch(url, {
      headers: { 'Range': `bytes=${start}-${end}` }
    });
    
    if (!response.ok && response.status !== 206) {
      throw new Error(`Chunk download failed: ${response.status}`);
    }
    
    return response.arrayBuffer();
  }

  assembleBlob() {
    const chunks = [];
    for (let start = 0; start < this.totalSize; start += this.chunkSize) {
      const data = this.downloadedChunks.get(start);
      if (data) chunks.push(data);
    }
    return new Blob(chunks, { type: 'video/mp4' });
  }

  async fallbackDownload(url, videoElement) {
    const response = await fetch(url);
    const reader = response.body.getReader();
    const chunks = [];
    let downloaded = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.length;
      this.onProgress(downloaded, this.totalSize || downloaded);
    }
    
    const blob = new Blob(chunks, { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    videoElement.src = blobUrl;
    this.onComplete(blobUrl);
  }

  abort() {
    this.aborted = true;
  }
}

window.AcceleratedDownloader = AcceleratedDownloader;