import "dotenv/config";
import express from "express";

const app = express();

const PORT = Number(process.env.PORT || 3000);
const YUMMY_TOKEN = String(process.env.YUMMY_TOKEN || "").trim();

const YUMMY_API = "https://api.yani.tv";
const REQUEST_TIMEOUT_MS = 30_000;

if (!YUMMY_TOKEN) {
    console.error("");
    console.error("ОШИБКА: переменная YUMMY_TOKEN не задана.");
    console.error("Создайте файл .env:");
    console.error("YUMMY_TOKEN=ваш_токен");
    console.error("PORT=3000");
    console.error("");

    process.exit(1);
}

app.disable("etag");
app.use(express.json());

app.use((req, res, next) => {
    const startedAt = Date.now();

    console.log(
        `[${new Date().toISOString()}] --> ` +
        `${req.method} ${req.originalUrl}`
    );

    res.on("finish", () => {
        console.log(
            `[${new Date().toISOString()}] <-- ` +
            `${req.method} ${req.originalUrl} ` +
            `${res.statusCode} ${Date.now() - startedAt}ms`
        );
    });

    next();
});

function getErrorMessage(error) {
    if (error?.name === "AbortError") {
        return `Тайм-аут запроса ${REQUEST_TIMEOUT_MS} мс`;
    }

    if (error?.cause?.message) {
        return `${error.message}: ${error.cause.message}`;
    }

    return error?.message || String(error);
}

async function yummyRequest(pathname, query = {}) {
    const url = new URL(pathname, YUMMY_API);

    for (const [key, value] of Object.entries(query)) {
        if (
            value !== undefined &&
            value !== null &&
            String(value) !== ""
        ) {
            url.searchParams.set(key, String(value));
        }
    }

    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
        console.log(`[YummyAnime] GET ${url}`);

        const response = await fetch(url, {
            method: "GET",
            redirect: "follow",
            headers: {
                "X-Application": YUMMY_TOKEN,
                "Lang": "ru",
                "Accept-Language": "ru-RU,ru;q=0.9",
                "Accept": "application/json,image/avif,image/webp",
                "User-Agent": "AnimeTvParserTest/5.0"
            },
            signal: controller.signal
        });

        const text = await response.text();

        let body = null;

        if (text.trim()) {
            try {
                body = JSON.parse(text);
            } catch {
                throw new Error(
                    `API вернул не JSON. HTTP ${response.status}: ` +
                    text.substring(0, 300)
                );
            }
        }

        if (!response.ok) {
            const apiMessage =
                body?.message ||
                body?.error ||
                body?.response?.message ||
                JSON.stringify(body);

            throw new Error(
                `YummyAnime HTTP ${response.status}: ${apiMessage}`
            );
        }

        return body;
    } finally {
        clearTimeout(timeoutId);
    }
}

function unwrapAnimeList(raw) {
    const candidates = [
        raw?.response?.data,
        raw?.response?.anime,
        raw?.response?.items,
        raw?.response,
        raw?.data,
        raw?.items,
        raw
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    return [];
}

function unwrapVideos(raw) {
    const candidates = [
        raw?.response?.videos,
        raw?.response?.data,
        raw?.response?.items,
        raw?.response,
        raw?.videos,
        raw?.data,
        raw?.items,
        raw
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    return [];
}

function makeAbsoluteUrl(value) {
    if (!value || typeof value !== "string") {
        return null;
    }

    try {
        return new URL(value, "https://ru.yummyani.me").toString();
    } catch {
        return null;
    }
}

function getAnimeId(anime) {
    const value =
        anime?.anime_id ??
        anime?.id ??
        anime?.alias ??
        "";

    return String(value);
}

function getAnimeTitle(anime) {
    return (
        anime?.title ||
        anime?.name ||
        anime?.title_ru ||
        anime?.russian ||
        anime?.original ||
        "Без названия"
    );
}

function getPosterUrl(anime) {
    const poster =
        anime?.poster?.fullsize ||
        anime?.poster?.original ||
        anime?.poster?.medium ||
        anime?.poster?.big ||
        anime?.poster?.huge ||
        anime?.poster?.mega ||
        anime?.poster?.preview ||
        anime?.poster ||
        anime?.image ||
        null;

    return makeAbsoluteUrl(poster);
}

function parseEpisodeNumber(value) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return null;
    }

    const match = String(value).match(/\d+(?:[.,]\d+)?/);

    if (!match) {
        return null;
    }

    const result = Number(match[0].replace(",", "."));

    return Number.isFinite(result) ? result : null;
}

function getRawVideoUrl(video) {
    return (
        video?.iframe_url ||
        video?.iframe ||
        video?.url ||
        video?.src ||
        video?.file ||
        video?.data?.iframe_url ||
        video?.data?.url ||
        null
    );
}

function getVideoUrl(video) {
    return makeAbsoluteUrl(getRawVideoUrl(video));
}

function getEpisodeFromUrl(value) {
    if (!value) {
        return null;
    }

    try {
        const url = new URL(value);

        const parameters = [
            "episode",
            "episode_number",
            "ep"
        ];

        for (const parameter of parameters) {
            const result = parseEpisodeNumber(
                url.searchParams.get(parameter)
            );

            if (result !== null) {
                return result;
            }
        }

        const pathMatch = url.pathname.match(
            /(?:episode|ep)[-_/]?(\d+(?:[.,]\d+)?)/i
        );

        if (pathMatch) {
            return parseEpisodeNumber(pathMatch[1]);
        }
    } catch {
        return null;
    }

    return null;
}

function getEpisodeNumber(video, fallback = null) {
    const explicitValues = [
        video?.number,
        video?.episode,
        video?.episode_number,
        video?.episodeNumber,
        video?.data?.episode,
        video?.data?.number,
        video?.data?.episode_number
    ];

    for (const value of explicitValues) {
        const result = parseEpisodeNumber(value);

        if (result !== null) {
            return result;
        }
    }

    const fromUrl = getEpisodeFromUrl(getRawVideoUrl(video));

    if (fromUrl !== null) {
        return fromUrl;
    }

    return fallback;
}

function getDubbingName(video) {
    return (
        video?.data?.dubbing ||
        video?.dubbing ||
        video?.translate?.title ||
        video?.translation?.title ||
        video?.translation ||
        "Без указания озвучки"
    );
}

function getPlayerName(video) {
    return (
        video?.data?.player ||
        video?.player?.title ||
        video?.player ||
        "Неизвестный плеер"
    );
}

function isDirectMediaUrl(url) {
    if (!url) {
        return false;
    }

    const normalized = url.toLowerCase();

    return (
        normalized.includes(".m3u8") ||
        normalized.includes(".mp4") ||
        normalized.includes(".webm") ||
        normalized.includes(".mpd")
    );
}

function getPlayerPriority(video) {
    const url = getVideoUrl(video)?.toLowerCase() || "";
    const player = getPlayerName(video).toLowerCase();

    if (isDirectMediaUrl(url)) {
        return 100;
    }

    if (
        url.includes("alloha") ||
        player.includes("alloha")
    ) {
        return 90;
    }

    if (
        url.includes("kodik") ||
        player.includes("kodik")
    ) {
        return 80;
    }

    if (
        url.includes("vk.com") ||
        url.includes("vkvideo") ||
        player.includes("vk")
    ) {
        return 70;
    }

    return 10;
}

function selectVideo(videos, requestedEpisode) {
    const matching = videos.filter(video => {
        const episode = getEpisodeNumber(video);

        return (
            episode !== null &&
            Math.abs(episode - requestedEpisode) < 0.001
        );
    });

    if (matching.length === 0) {
        return null;
    }

    return matching.sort(
        (a, b) => getPlayerPriority(b) - getPlayerPriority(a)
    )[0];
}

app.get("/health", async (req, res) => {
    try {
        await yummyRequest("/anime", {
            limit: 1,
            offset: 0
        });

        res.set("Cache-Control", "no-store");

        res.json({
            ok: true,
            source: "YummyAnime",
            tokenConfigured: true,
            apiAvailable: true,
            time: new Date().toISOString()
        });
    } catch (error) {
        console.error("[HEALTH ERROR]", error);

        res.status(502).json({
            ok: false,
            source: "YummyAnime",
            tokenConfigured: true,
            apiAvailable: false,
            error: getErrorMessage(error)
        });
    }
});

app.get("/search", async (req, res) => {
    try {
        const query = String(req.query.q || "").trim();

        if (!query) {
            return res.status(400).json({
                error: "Не указан поисковый запрос q"
            });
        }

        const raw = await yummyRequest("/anime", {
            q: query,
            limit: 20,
            offset: 0
        });

        const animeList = unwrapAnimeList(raw);

        const result = animeList
            .map(anime => {
                const id = getAnimeId(anime);

                if (!id) {
                    return null;
                }

                return {
                    id,
                    title: getAnimeTitle(anime),
                    year:
                        Number(
                            anime?.year ??
                            anime?.aired_on?.year
                        ) || null,

                    posterUrl: getPosterUrl(anime),

                    episodesTotal:
                        Number(
                            anime?.episodes?.count ??
                            anime?.episodes_count ??
                            anime?.episodes
                        ) || null,

                    episodesAired:
                        Number(
                            anime?.episodes?.aired ??
                            anime?.episodes_aired
                        ) || null,

                    isOngoing:
                        anime?.anime_status?.alias === "ongoing" ||
                        anime?.status === "ongoing",

                    source: "yummyanime"
                };
            })
            .filter(Boolean);

        res.set("Cache-Control", "no-store");
        res.json(result);
    } catch (error) {
        console.error("[SEARCH ERROR]", error);

        res.status(502).json({
            error: "Не удалось выполнить поиск",
            details: getErrorMessage(error)
        });
    }
});

app.get("/episodes/:id", async (req, res) => {
    try {
        const animeId = String(req.params.id || "").trim();

        if (!animeId) {
            return res.status(400).json({
                error: "Не указан ID аниме"
            });
        }

        const raw = await yummyRequest(
            `/anime/${encodeURIComponent(animeId)}/videos`
        );

        const videos = unwrapVideos(raw);
        const episodesMap = new Map();

        videos.forEach(video => {
            const episodeNumber = getEpisodeNumber(video);

            if (
                episodeNumber === null ||
                !Number.isFinite(episodeNumber)
            ) {
                return;
            }

            const url = getVideoUrl(video);

            if (!url) {
                return;
            }

            const dubbing = getDubbingName(video);
            const player = getPlayerName(video);

            let episode = episodesMap.get(episodeNumber);

            if (!episode) {
                episode = {
                    episode: episodeNumber,
                    title: `Серия ${episodeNumber}`,
                    available: true,
                    dubbings: [],
                    players: []
                };

                episodesMap.set(episodeNumber, episode);
            }

            if (!episode.dubbings.includes(dubbing)) {
                episode.dubbings.push(dubbing);
            }

            if (!episode.players.includes(player)) {
                episode.players.push(player);
            }
        });

        const result = [...episodesMap.values()]
            .sort((a, b) => a.episode - b.episode);

        res.set("Cache-Control", "no-store");
        res.json(result);
    } catch (error) {
        console.error("[EPISODES ERROR]", error);

        res.status(502).json({
            error: "Не удалось получить список серий",
            details: getErrorMessage(error)
        });
    }
});

app.get("/video", async (req, res) => {
    try {
        /*
         * Имя shikimoriId оставлено только для совместимости
         * с ранее созданным Android-приложением.
         *
         * На самом деле сюда передается ID YummyAnime.
         */
        const animeId = String(
            req.query.shikimoriId ||
            req.query.id ||
            ""
        ).trim();

        const requestedEpisode = Number(req.query.episode);

        if (!animeId) {
            return res.status(400).json({
                error: "Не указан ID аниме"
            });
        }

        if (!Number.isFinite(requestedEpisode)) {
            return res.status(400).json({
                error: "Некорректный номер серии"
            });
        }

        const raw = await yummyRequest(
            `/anime/${encodeURIComponent(animeId)}/videos`
        );

        const videos = unwrapVideos(raw);

        const selected = selectVideo(
            videos,
            requestedEpisode
        );

        if (!selected) {
            return res.status(404).json({
                error:
                    `Серия ${requestedEpisode} не найдена. ` +
                    "Проверьте /debug/videos/ID"
            });
        }

        const url = getVideoUrl(selected);

        if (!url) {
            return res.status(404).json({
                error: "API не вернул ссылку на плеер"
            });
        }

        const actualEpisode = getEpisodeNumber(
            selected,
            requestedEpisode
        );

        const direct = isDirectMediaUrl(url);

        res.set("Cache-Control", "no-store");

        res.json({
            url,
            direct,
            source: "yummyanime",
            episode: actualEpisode,
            dubbing: getDubbingName(selected),
            player: getPlayerName(selected),

            videoId:
                selected?.video_id ??
                selected?.id ??
                null,

            warning: direct
                ? null
                : "Получена страница встроенного плеера"
        });
    } catch (error) {
        console.error("[VIDEO ERROR]", error);

        res.status(502).json({
            error: "Не удалось получить видео",
            details: getErrorMessage(error)
        });
    }
});

app.get("/debug/videos/:id", async (req, res) => {
    try {
        const animeId = String(req.params.id || "").trim();

        if (!animeId) {
            return res.status(400).json({
                error: "Не указан ID аниме"
            });
        }

        const raw = await yummyRequest(
            `/anime/${encodeURIComponent(animeId)}/videos`
        );

        const videos = unwrapVideos(raw);

        const result = videos
            .map(video => {
                const url = getVideoUrl(video);

                return {
                    videoId:
                        video?.video_id ??
                        video?.id ??
                        null,

                    episode: getEpisodeNumber(video),
                    dubbing: getDubbingName(video),
                    player: getPlayerName(video),
                    url,
                    direct: isDirectMediaUrl(url)
                };
            })
            .filter(item => item.url)
            .sort((a, b) => {
                const episodeA = a.episode ?? Number.MAX_VALUE;
                const episodeB = b.episode ?? Number.MAX_VALUE;

                return episodeA - episodeB;
            });

        res.set("Cache-Control", "no-store");
        res.json(result);
    } catch (error) {
        console.error("[DEBUG ERROR]", error);

        res.status(502).json({
            error: "Не удалось получить список плееров",
            details: getErrorMessage(error)
        });
    }
});

app.get("/favicon.ico", (req, res) => {
    res.status(204).end();
});

app.use((req, res) => {
    res.status(404).json({
        error: "Маршрут не найден"
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("===========================================");
    console.log(" Anime TV Server — YummyAnime");
    console.log("===========================================");
    console.log(`Сервер:   http://0.0.0.0:${PORT}`);
    console.log(`Проверка: http://localhost:${PORT}/health`);
    console.log("");
    console.log("YUMMY_TOKEN загружен.");
    console.log("Jikan и Shikimori не используются.");
    console.log("===========================================");
    console.log("");
});
