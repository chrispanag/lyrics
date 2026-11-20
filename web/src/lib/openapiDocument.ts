import { API_SCOPES } from "@/lib/apiScopes";
import { AUTHORIZATION_SERVER } from "@/lib/protectedResource";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * OpenAPI 3.1 description of `/api/v1`. Served at `/openapi.json`.
 *
 * Scopes are `API_SCOPES`: the same names `scopes_supported` publishes.
 * `email:verify` is enforced on the token. The other scopes are the
 * least-privilege grants a client should request; the API still authorizes
 * writes by the account's role.
 */

type Json = Record<string, unknown>;

const errorRef = { $ref: "#/components/schemas/Error" };

function jsonResponse(description: string, schema: Json): Json {
  return { description, content: { "application/json": { schema } } };
}

function listSchema(itemRef: string): Json {
  return {
    type: "object",
    required: ["data", "meta"],
    properties: {
      data: { type: "array", items: { $ref: itemRef } },
      meta: { $ref: "#/components/schemas/Page" },
    },
  };
}

/** Auth is optional: the empty requirement allows a guest. */
function optionalScope(scope: string): Json[] {
  return [{ oauth2: [scope] }, {}];
}

function requiredScope(scope: string): Json[] {
  return [{ oauth2: [scope] }];
}

const pageParams: Json[] = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    description: "Page size. Values above 100 are clamped.",
  },
  {
    name: "offset",
    in: "query",
    schema: { type: "integer", minimum: 0, default: 0 },
  },
];

const songId: Json = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "The song's slug, or its UUID.",
};

const uuidId: Json = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

/** The OpenAPI document. */
export function openApiDocument(): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: "Songfolio API",
      version: "1.0.0",
      summary: "Read and edit the Songfolio lyrics catalog.",
      description:
        "JSON API for the Songfolio catalog at https://songfolio.live. " +
        "Collections use `{ data, meta: { total, limit, offset } }`. " +
        "Errors use `{ error: { code, message, details } }`. " +
        "A missing record is `not_found` with status 404. " +
        "Listing songs omits `lyrics`; a search hit may include a `snippet` " +
        "whose matches are wrapped in ⟦ and ⟧. " +
        "Song paths accept a slug or a UUID. " +
        "See https://songfolio.live/llms.txt for the site's addresses.",
    },
    servers: [{ url: `${SITE_ORIGIN}/api/v1` }],
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          description:
            "Prelude Auth (authorization code with PKCE, S256). Send the access token as " +
            "`Authorization: Bearer`. Catalog reads need no token. `email:verify` is a step-up " +
            "scope the API checks on the token. The other scopes are the least privilege a client " +
            "should request; writes are also limited by the account role (user, contributor, admin). " +
            "Register these scope names in the Prelude application before an authorization server " +
            "will grant them. Browser sessions are not rejected for omitting them. " +
            `Authorization server metadata: ${AUTHORIZATION_SERVER}/.well-known/oauth-authorization-server. ` +
            `Protected resource metadata: ${SITE_ORIGIN}/.well-known/oauth-protected-resource.`,
          flows: {
            authorizationCode: {
              authorizationUrl: `${AUTHORIZATION_SERVER}/v1/session/oauth/authorize`,
              tokenUrl: `${AUTHORIZATION_SERVER}/v1/session/oauth/token`,
              scopes: API_SCOPES,
            },
          },
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: {
                  type: "string",
                  enum: [
                    "bad_request",
                    "validation_failed",
                    "unauthorized",
                    "forbidden",
                    "not_found",
                    "no_route",
                    "conflict",
                    "rate_limited",
                    "upstream_error",
                    "internal_error",
                  ],
                },
                message: { type: "string" },
                details: { type: "object", additionalProperties: { type: "string" } },
              },
            },
          },
        },
        Page: {
          type: "object",
          required: ["total", "limit", "offset"],
          properties: {
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
        Credit: {
          type: "object",
          required: ["person_id", "role"],
          properties: {
            person_id: { type: "string", format: "uuid" },
            name: { type: "string" },
            role: { type: "string", enum: ["composer", "lyricist"] },
            position: { type: "integer" },
          },
        },
        Recording: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            label: { type: ["string", "null"] },
            youtube_url: { type: ["string", "null"] },
            youtube_video_id: { type: ["string", "null"] },
            release_year: { type: ["integer", "null"] },
            notes: { type: ["string", "null"] },
            is_first: { type: "boolean" },
            position: { type: "integer" },
            performers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  person_id: { type: "string", format: "uuid" },
                  name: { type: "string" },
                  position: { type: "integer" },
                },
              },
            },
          },
        },
        Song: {
          type: "object",
          required: ["id", "title", "slug", "language"],
          properties: {
            id: { type: "string", format: "uuid" },
            title: { type: "string" },
            slug: { type: "string" },
            alt_title: { type: ["string", "null"] },
            lyrics: {
              type: "string",
              description: "Present on a single-song read. Listings omit it.",
            },
            language: { type: "string", description: "A two-letter code such as el or en." },
            youtube_url: { type: ["string", "null"] },
            youtube_video_id: { type: ["string", "null"] },
            release_year: { type: ["integer", "null"] },
            notes: { type: ["string", "null"] },
            credits: { type: "array", items: { $ref: "#/components/schemas/Credit" } },
            genres: { type: "array", items: { $ref: "#/components/schemas/Genre" } },
            recordings: { type: "array", items: { $ref: "#/components/schemas/Recording" } },
            snippet: {
              type: "string",
              description: "Search hit only. Matches are wrapped in ⟦ and ⟧.",
            },
            popularity: { $ref: "#/components/schemas/Popularity" },
          },
        },
        Popularity: {
          type: "object",
          properties: {
            anonymous_clicks: { type: "integer" },
            authenticated_clicks: { type: "integer" },
            list_adds: { type: "integer" },
            list_users: { type: "integer" },
            score: { type: "integer" },
          },
        },
        Person: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            song_count: {
              type: "integer",
              description: "Omitted when zero. Read an absent count as 0.",
            },
          },
        },
        Genre: {
          type: "object",
          required: ["id", "name", "slug"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            slug: { type: "string" },
            song_count: { type: "integer", description: "Omitted when zero." },
          },
        },
        SongList: {
          type: "object",
          required: ["id", "name", "is_public"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            is_public: { type: "boolean" },
            is_default: { type: "boolean" },
            item_count: { type: "integer" },
            songs: { type: "array", items: { $ref: "#/components/schemas/Song" } },
          },
        },
        User: {
          type: "object",
          required: ["id", "email", "role"],
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            display_name: { type: ["string", "null"] },
            role: { type: "string", enum: ["user", "contributor", "admin"] },
            email_verified_at: { type: ["string", "null"], format: "date-time" },
          },
        },
        SongWrite: {
          type: "object",
          required: ["title", "lyrics", "language"],
          properties: {
            title: { type: "string" },
            alt_title: { type: ["string", "null"] },
            lyrics: { type: "string" },
            language: { type: "string" },
            notes: { type: ["string", "null"] },
            credits: { type: "array", items: { $ref: "#/components/schemas/Credit" } },
            genre_ids: { type: "array", items: { type: "string", format: "uuid" } },
            recordings: { type: "array", items: { $ref: "#/components/schemas/Recording" } },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          operationId: "health",
          summary: "Check that the API can reach the database.",
          security: [],
          responses: {
            "200": jsonResponse("The database answered.", {
              type: "object",
              properties: { status: { type: "string", const: "ok" } },
            }),
            "500": jsonResponse("The database is unreachable.", errorRef),
          },
        },
      },
      "/songs": {
        get: {
          operationId: "listSongs",
          summary: "Search and browse songs. Lyrics are omitted.",
          security: optionalScope("catalog:read"),
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "person", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "performer", in: "query", schema: { type: "string", format: "uuid" } },
            {
              name: "artist",
              in: "query",
              schema: { type: "string", format: "uuid" },
              description: "Alias of performer. Sending both is a 400.",
            },
            { name: "composer", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "lyricist", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "genre_slug", in: "query", schema: { type: "string" } },
            { name: "genre", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "language", in: "query", schema: { type: "string" } },
            { name: "year_from", in: "query", schema: { type: "integer" } },
            { name: "year_to", in: "query", schema: { type: "integer" } },
            { name: "created_by", in: "query", schema: { type: "string", format: "uuid" } },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["relevance", "title", "newest", "oldest", "popularity"],
              },
            },
            ...pageParams,
          ],
          responses: {
            "200": jsonResponse("A page of songs.", listSchema("#/components/schemas/Song")),
            "400": jsonResponse("A query parameter was not understood.", errorRef),
          },
        },
        post: {
          operationId: "createSong",
          summary: "Add a song. Requires the contributor role.",
          security: requiredScope("catalog:write"),
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SongWrite" } },
            },
          },
          responses: {
            "201": jsonResponse("The created song, lyrics included.", {
              $ref: "#/components/schemas/Song",
            }),
            "401": jsonResponse("No token.", errorRef),
            "403": jsonResponse("The account cannot add songs.", errorRef),
            "422": jsonResponse("The song was rejected.", errorRef),
          },
        },
      },
      "/songs/{id}": {
        get: {
          operationId: "getSong",
          summary: "One song, lyrics included.",
          security: optionalScope("catalog:read"),
          parameters: [songId],
          responses: {
            "200": jsonResponse("The song.", { $ref: "#/components/schemas/Song" }),
            "404": jsonResponse("No song has that slug or id.", errorRef),
          },
        },
        patch: {
          operationId: "updateSong",
          summary: "Edit a song. Contributors may edit their own; admins, any.",
          security: requiredScope("catalog:write"),
          parameters: [songId],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SongWrite" },
              },
            },
          },
          responses: {
            "200": jsonResponse("The updated song.", { $ref: "#/components/schemas/Song" }),
            "403": jsonResponse("The account cannot edit this song.", errorRef),
            "404": jsonResponse("No such song.", errorRef),
          },
        },
        delete: {
          operationId: "deleteSong",
          summary: "Delete a song. Requires the admin role.",
          security: requiredScope("catalog:admin"),
          parameters: [songId],
          responses: {
            "204": { description: "Deleted." },
            "403": jsonResponse("The account is not an admin.", errorRef),
            "404": jsonResponse("No such song.", errorRef),
          },
        },
      },
      "/songs/{id}/clicks": {
        post: {
          operationId: "recordSongClick",
          summary: "Record one opening of a song.",
          security: optionalScope("catalog:read"),
          parameters: [songId],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    visitor_id: {
                      type: "string",
                      format: "uuid",
                      description: "Required for a guest. Ignored when a token is sent.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": jsonResponse("The song's popularity after the click.", {
              $ref: "#/components/schemas/Popularity",
            }),
            "429": jsonResponse("Too many clicks.", errorRef),
          },
        },
      },
      "/songs/{id}/lists": {
        get: {
          operationId: "listsContainingSong",
          summary: "The signed-in user's lists that contain this song.",
          security: requiredScope("lists:read"),
          parameters: [songId],
          responses: {
            "200": jsonResponse("The caller's lists.", listSchema("#/components/schemas/SongList")),
            "401": jsonResponse("No token.", errorRef),
          },
        },
      },
      "/people": {
        get: {
          operationId: "listPeople",
          summary: "Find people, with how many songs each is on.",
          security: optionalScope("catalog:read"),
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            {
              name: "role",
              in: "query",
              schema: { type: "string", enum: ["composer", "lyricist", "performer"] },
            },
            ...pageParams,
          ],
          responses: {
            "200": jsonResponse("A page of people.", listSchema("#/components/schemas/Person")),
          },
        },
        post: {
          operationId: "createPerson",
          summary: "Add a person. Requires the contributor role.",
          security: requiredScope("catalog:write"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": jsonResponse("The created person.", { $ref: "#/components/schemas/Person" }),
            "403": jsonResponse("The account cannot add people.", errorRef),
          },
        },
      },
      "/people/{id}": {
        get: {
          operationId: "getPerson",
          security: optionalScope("catalog:read"),
          parameters: [uuidId],
          responses: {
            "200": jsonResponse("The person.", { $ref: "#/components/schemas/Person" }),
            "404": jsonResponse("No such person.", errorRef),
          },
        },
        patch: {
          operationId: "updatePerson",
          summary: "Rename a person. Requires the admin role.",
          security: requiredScope("catalog:admin"),
          parameters: [uuidId],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": jsonResponse("The updated person.", { $ref: "#/components/schemas/Person" }),
            "403": jsonResponse("The account is not an admin.", errorRef),
          },
        },
        delete: {
          operationId: "deletePerson",
          security: requiredScope("catalog:admin"),
          parameters: [uuidId],
          responses: {
            "204": { description: "Deleted." },
            "403": jsonResponse("The account is not an admin.", errorRef),
          },
        },
      },
      "/credited-people": {
        get: {
          operationId: "creditedPeople",
          summary: "Every person on at least one song, oldest first. For the sitemap.",
          security: optionalScope("catalog:read"),
          parameters: pageParams,
          responses: {
            "200": jsonResponse("Ids only.", {
              type: "object",
              properties: {
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { id: { type: "string", format: "uuid" } },
                  },
                },
                meta: { $ref: "#/components/schemas/Page" },
              },
            }),
          },
        },
      },
      "/genres": {
        get: {
          operationId: "listGenres",
          security: optionalScope("catalog:read"),
          responses: {
            "200": jsonResponse("Every genre.", listSchema("#/components/schemas/Genre")),
          },
        },
        post: {
          operationId: "createGenre",
          summary: "Add a genre. Requires the contributor role.",
          security: requiredScope("catalog:write"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": jsonResponse("The created genre.", { $ref: "#/components/schemas/Genre" }),
            "403": jsonResponse("The account cannot add genres.", errorRef),
          },
        },
      },
      "/genres/{id}": {
        patch: {
          operationId: "updateGenre",
          security: requiredScope("catalog:admin"),
          parameters: [uuidId],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", properties: { name: { type: "string" } } },
              },
            },
          },
          responses: {
            "200": jsonResponse("The updated genre.", { $ref: "#/components/schemas/Genre" }),
          },
        },
        delete: {
          operationId: "deleteGenre",
          security: requiredScope("catalog:admin"),
          parameters: [uuidId],
          responses: { "204": { description: "Deleted." } },
        },
      },
      "/lists": {
        get: {
          operationId: "listLists",
          summary: "The signed-in user's lists.",
          security: requiredScope("lists:read"),
          responses: {
            "200": jsonResponse("The caller's lists.", listSchema("#/components/schemas/SongList")),
            "401": jsonResponse("No token.", errorRef),
          },
        },
        post: {
          operationId: "createList",
          security: requiredScope("lists:write"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    description: { type: ["string", "null"] },
                    is_public: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "201": jsonResponse("The created list.", { $ref: "#/components/schemas/SongList" }),
          },
        },
      },
      "/lists/{id}": {
        get: {
          operationId: "getList",
          summary: "A public list, or one of the caller's own, with its songs.",
          security: optionalScope("lists:read"),
          parameters: [uuidId],
          responses: {
            "200": jsonResponse("The list.", { $ref: "#/components/schemas/SongList" }),
            "404": jsonResponse("The list is missing or private.", errorRef),
          },
        },
        patch: {
          operationId: "updateList",
          security: requiredScope("lists:write"),
          parameters: [uuidId],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: ["string", "null"] },
                    is_public: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": jsonResponse("The updated list.", { $ref: "#/components/schemas/SongList" }),
          },
        },
        delete: {
          operationId: "deleteList",
          security: requiredScope("lists:write"),
          parameters: [uuidId],
          responses: { "204": { description: "Deleted." } },
        },
      },
      "/lists/{id}/copy": {
        post: {
          operationId: "copyList",
          summary: "Copy a public list, or one of the caller's own, into a new list.",
          security: requiredScope("lists:write"),
          parameters: [uuidId],
          responses: {
            "201": jsonResponse("The new list.", { $ref: "#/components/schemas/SongList" }),
          },
        },
      },
      "/lists/{id}/songs/{songID}": {
        put: {
          operationId: "addSongToList",
          security: requiredScope("lists:write"),
          parameters: [
            uuidId,
            {
              name: "songID",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The song's slug or UUID.",
            },
          ],
          responses: { "204": { description: "Added." } },
        },
        delete: {
          operationId: "removeSongFromList",
          security: requiredScope("lists:write"),
          parameters: [
            uuidId,
            { name: "songID", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "204": { description: "Removed." } },
        },
      },
      "/lists/{id}/reorder": {
        post: {
          operationId: "reorderList",
          security: requiredScope("lists:write"),
          parameters: [uuidId],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["song_ids"],
                  properties: {
                    song_ids: { type: "array", items: { type: "string", format: "uuid" } },
                  },
                },
              },
            },
          },
          responses: { "204": { description: "Reordered." } },
        },
      },
      "/public-lists": {
        get: {
          operationId: "publicLists",
          summary: "Every public list's id and updated_at, oldest first. For the sitemap.",
          security: optionalScope("catalog:read"),
          parameters: pageParams,
          responses: {
            "200": jsonResponse("Addresses only.", {
              type: "object",
              properties: {
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      updated_at: { type: "string", format: "date-time" },
                    },
                  },
                },
                meta: { $ref: "#/components/schemas/Page" },
              },
            }),
          },
        },
      },
      "/users/{id}/avatar": {
        get: {
          operationId: "getAvatar",
          summary: "A profile picture. No token: an image request cannot send one.",
          security: optionalScope("catalog:read"),
          parameters: [uuidId],
          responses: {
            "200": {
              description: "The picture, as JPEG.",
              content: { "image/jpeg": { schema: { type: "string", format: "binary" } } },
            },
            "404": jsonResponse("This account has no picture.", errorRef),
          },
        },
      },
      "/auth/register": {
        post: {
          operationId: "register",
          summary: "Create an account.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                    display_name: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": jsonResponse("The new account.", { $ref: "#/components/schemas/User" }),
            "409": jsonResponse("That email is already registered.", errorRef),
            "422": jsonResponse("The account was rejected.", errorRef),
            "429": jsonResponse("Too many registration attempts.", errorRef),
          },
        },
      },
      "/auth/verify-email": {
        post: {
          operationId: "verifyEmail",
          summary: "Record an email proved by the email:verify step-up scope. No body.",
          security: requiredScope("email:verify"),
          responses: {
            "200": jsonResponse("The account, now verified.", {
              $ref: "#/components/schemas/User",
            }),
            "403": jsonResponse("The token does not carry email:verify.", errorRef),
          },
        },
      },
      "/me": {
        get: {
          operationId: "getMe",
          security: requiredScope("account:read"),
          responses: {
            "200": jsonResponse("The signed-in account.", { $ref: "#/components/schemas/User" }),
            "401": jsonResponse("No token.", errorRef),
          },
        },
        patch: {
          operationId: "updateMe",
          summary: "Change the signed-in profile. An omitted field is left alone.",
          security: requiredScope("account:write"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { display_name: { type: ["string", "null"] } },
                },
              },
            },
          },
          responses: {
            "200": jsonResponse("The updated account.", { $ref: "#/components/schemas/User" }),
          },
        },
      },
      "/me/avatar": {
        post: {
          operationId: "uploadAvatar",
          summary: "Upload a profile picture as raw image bytes, at most 1 MB.",
          security: requiredScope("account:write"),
          requestBody: {
            required: true,
            content: {
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
            },
          },
          responses: {
            "200": jsonResponse("The updated account.", { $ref: "#/components/schemas/User" }),
          },
        },
        delete: {
          operationId: "deleteAvatar",
          security: requiredScope("account:write"),
          responses: {
            "200": jsonResponse("The updated account.", { $ref: "#/components/schemas/User" }),
          },
        },
      },
      "/admin/users": {
        get: {
          operationId: "listUsers",
          summary: "List accounts. Requires the admin role.",
          security: requiredScope("catalog:admin"),
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            {
              name: "role",
              in: "query",
              schema: { type: "string", enum: ["user", "contributor", "admin"] },
            },
            ...pageParams,
          ],
          responses: {
            "200": jsonResponse("A page of accounts.", listSchema("#/components/schemas/User")),
            "403": jsonResponse("The account is not an admin.", errorRef),
          },
        },
      },
      "/admin/users/{id}/role": {
        patch: {
          operationId: "setUserRole",
          security: requiredScope("catalog:admin"),
          parameters: [uuidId],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["role"],
                  properties: {
                    role: { type: "string", enum: ["user", "contributor", "admin"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": jsonResponse("The updated account.", { $ref: "#/components/schemas/User" }),
          },
        },
      },
      "/admin/users/{id}": {
        delete: {
          operationId: "deleteUser",
          security: requiredScope("catalog:admin"),
          parameters: [uuidId],
          responses: { "204": { description: "Deleted." } },
        },
      },
    },
  };
}
