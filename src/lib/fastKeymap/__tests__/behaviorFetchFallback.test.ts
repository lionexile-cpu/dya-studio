import { loadFastKeymap, FastKeymapCacheKeys } from "../fastKeymap";
import { FK_DEFINITION_VERSION } from "../standardBehaviors";
import {
  BehaviorDetailsMode,
  type Request,
  type Response,
  type Snapshot,
} from "../../../proto/cormoran/fast_keymap/fast_keymap";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const DEVICE = "kbd";
const IDS = [10, 11, 12];
// def_fps that no bundled standard behavior uses, so every id is a miss.
const defFp = (id: number) => 0xbe00 + id;

const SNAPSHOT: Snapshot = {
  definitionVersion: FK_DEFINITION_VERSION,
  behaviorsFp: 999,
  defaultKeymapFp: 0,
  keymapFp: 0,
  physicalLayoutFp: 222,
  behaviorCount: IDS.length,
  maxLayerNameLength: 16,
  availableLayers: 4,
  activeLayoutIndex: 0,
  layers: [
    { id: 1, name: "base", bindingCount: 1, fp: 333, defaultFp: 333, editedCount: 0 },
  ],
  defFpBits: 16,
};

function seed(storage: Storage) {
  storage.setItem(
    FastKeymapCacheKeys.layer(DEVICE, 333),
    JSON.stringify([{ behaviorId: 10, param1: 0, param2: 0 }]),
  );
  storage.setItem(
    FastKeymapCacheKeys.layouts(DEVICE),
    JSON.stringify({
      fp: 222,
      activeLayoutIndex: 0,
      layouts: [{ name: "active", fp: 1, keys: [] }],
    }),
  );
}

/** Device whose large responses fail: list_behaviors with inline details and
 * any multi-id get_behaviors throw; slim listing and single ids work. */
function flakyCall() {
  return jest.fn(async (req: Request): Promise<Response> => {
    if (req.getSnapshot) return { snapshot: SNAPSHOT } as Response;
    if (req.listBehaviors) {
      if (req.listBehaviors.details !== BehaviorDetailsMode.BEHAVIOR_DETAILS_NONE) {
        throw new Error("response too large");
      }
      return {
        listBehaviors: {
          behaviors: IDS.map((id) => ({ localId: id, defFp: defFp(id), details: undefined })),
        },
      } as unknown as Response;
    }
    if (req.getBehaviors) {
      const ids = req.getBehaviors.behaviorIds;
      if (ids.length > 1) throw new Error("response too large");
      return {
        getBehaviors: {
          behaviors: ids.map((id) => ({
            id,
            details: { displayName: `B${id}`, alias: "", metadata: [] },
          })),
        },
      } as unknown as Response;
    }
    throw new Error(`unexpected RPC ${Object.keys(req).join(",")}`);
  });
}

describe("loadFastKeymap behavior fetch fallback", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("resolves every behavior when large responses fail", async () => {
    const storage = memoryStorage();
    seed(storage);
    const model = await loadFastKeymap(flakyCall(), {
      deviceKey: DEVICE,
      storage,
      firstLayerOnly: true,
    });
    expect(model.behaviors.map((b) => b.displayName)).toEqual(["B10", "B11", "B12"]);
    expect(storage.getItem(FastKeymapCacheKeys.behaviors(DEVICE))).not.toBeNull();
  });

  it("does not cache placeholders and ignores blank cached entries", async () => {
    const storage = memoryStorage();
    seed(storage);
    // A whole-set cache written by an older build with blank labels.
    storage.setItem(
      FastKeymapCacheKeys.behaviors(DEVICE),
      JSON.stringify({
        fp: 999,
        defFpBits: 16,
        behaviors: IDS.map((id) => ({
          localId: id,
          alias: "",
          displayName: "",
          defFp: defFp(id),
          metadata: [],
        })),
      }),
    );
    const call = flakyCall();
    const model = await loadFastKeymap(call, {
      deviceKey: DEVICE,
      storage,
      firstLayerOnly: true,
    });
    expect(model.behaviors.map((b) => b.displayName)).toEqual(["B10", "B11", "B12"]);
  });
});
