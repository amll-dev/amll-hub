import { useStore } from 'jotai';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';
import {
  keyMoveNextWordAtom,
  keyMovePrevWordAtom,
  keySyncEndAtom,
  keySyncNextAtom,
  keySyncStartAtom,
} from '$/states/keybindings.ts';
import { forceInvokeKeyBindingAtom } from '$/utils/keybindings.ts';

export const TouchSyncPanel: FC = () => {
  const store = useStore();
  return (
    <div className="mx-2 mb-2 shrink-0 rounded-lg border border-line bg-card p-2">
      <div className="grid grid-cols-6 grid-rows-2 gap-2">
        <Button
          variant="secondary"
          className="col-span-3 h-12 whitespace-nowrap px-0"
          onMouseDown={(evt) =>
            forceInvokeKeyBindingAtom(store, keyMovePrevWordAtom, evt.nativeEvent)
          }
          onTouchStart={(evt) =>
            forceInvokeKeyBindingAtom(store, keyMovePrevWordAtom, evt.nativeEvent)
          }
        >
          跳上词
        </Button>

        <Button
          variant="secondary"
          className="col-span-3 h-12 whitespace-nowrap px-0"
          onMouseDown={(evt) =>
            forceInvokeKeyBindingAtom(store, keyMoveNextWordAtom, evt.nativeEvent)
          }
          onTouchStart={(evt) =>
            forceInvokeKeyBindingAtom(store, keyMoveNextWordAtom, evt.nativeEvent)
          }
        >
          跳下词
        </Button>
        <Button
          variant="secondary"
          className="col-span-2 h-12 whitespace-nowrap px-0"
          onMouseDown={(evt) => forceInvokeKeyBindingAtom(store, keySyncStartAtom, evt.nativeEvent)}
          onTouchStart={(evt) =>
            forceInvokeKeyBindingAtom(store, keySyncStartAtom, evt.nativeEvent)
          }
        >
          起始轴
        </Button>
        <Button
          variant="secondary"
          className="col-span-2 h-12 whitespace-nowrap px-0"
          onClick={(evt) => forceInvokeKeyBindingAtom(store, keySyncNextAtom, evt.nativeEvent)}
          onTouchStart={(evt) => forceInvokeKeyBindingAtom(store, keySyncNextAtom, evt.nativeEvent)}
        >
          连续轴
        </Button>
        <Button
          variant="secondary"
          className="col-span-2 h-12 whitespace-nowrap px-0"
          onMouseDown={(evt) => forceInvokeKeyBindingAtom(store, keySyncEndAtom, evt.nativeEvent)}
          onTouchStart={(evt) => forceInvokeKeyBindingAtom(store, keySyncEndAtom, evt.nativeEvent)}
        >
          结束轴
        </Button>
      </div>
    </div>
  );
};
