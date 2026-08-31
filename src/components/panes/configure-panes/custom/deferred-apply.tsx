import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {PrimaryAccentButton} from '../../../inputs/accent-button';

export const isDeferredApplyCommand = (name: string | undefined) =>
  typeof name === 'string' &&
  (name.startsWith('id_qmk_tapping_') ||
    name.startsWith('id_qmk_tapdance_') ||
    name === 'id_qmk_rgb_sleep_timeout_exact');

type DeferredApplyHandle = {
  canApply: boolean;
  apply: () => Promise<void>;
};

type DeferredApplyRegistry = {
  setHandle: (id: string, handle: DeferredApplyHandle | null) => void;
};

const DeferredApplyRegistryContext = createContext<DeferredApplyRegistry | null>(
  null,
);
const DeferredApplyHandlesContext = createContext<
  Record<string, DeferredApplyHandle>
>({});
const DeferredApplyModeContext = createContext(false);

const ApplyRow = styled.div`
  width: 100%;
  max-width: 960px;
  display: flex;
  justify-content: flex-end;
  box-sizing: border-box;
  padding: 12px 5px 8px;
`;

export const DeferredApplyProvider = ({
  deferred,
  children,
}: {
  deferred: boolean;
  children: ReactNode;
}) => {
  const [handles, setHandles] = useState<Record<string, DeferredApplyHandle>>(
    {},
  );
  const setHandle = useCallback(
    (id: string, handle: DeferredApplyHandle | null) => {
      setHandles((current) => {
        if (handle === null) {
          if (!(id in current)) {
            return current;
          }
          const next = {...current};
          delete next[id];
          return next;
        }
        const previous = current[id];
        if (
          previous &&
          previous.canApply === handle.canApply &&
          previous.apply === handle.apply
        ) {
          return current;
        }
        return {...current, [id]: handle};
      });
    },
    [],
  );
  const registry = useMemo(() => ({setHandle}), [setHandle]);
  return (
    <DeferredApplyModeContext.Provider value={deferred}>
      <DeferredApplyRegistryContext.Provider value={registry}>
        <DeferredApplyHandlesContext.Provider value={handles}>
          {children}
        </DeferredApplyHandlesContext.Provider>
      </DeferredApplyRegistryContext.Provider>
    </DeferredApplyModeContext.Provider>
  );
};

export const useDeferredApplyMode = () => useContext(DeferredApplyModeContext);

export const useDeferredApplyRegistration = (
  id: string,
  canApply: boolean,
  apply: () => Promise<void>,
) => {
  const registry = useContext(DeferredApplyRegistryContext);
  useEffect(() => {
    if (!registry) {
      return;
    }
    registry.setHandle(id, {canApply, apply});
    return () => {
      registry.setHandle(id, null);
    };
  }, [registry, id, canApply, apply]);
};

export const DeferredApplyButton = () => {
  const {t} = useTranslation();
  const deferred = useContext(DeferredApplyModeContext);
  const handles = useContext(DeferredApplyHandlesContext);
  const [applying, setApplying] = useState(false);
  const entries = Object.values(handles);
  if (!deferred || entries.length === 0) {
    return null;
  }
  const canApply = entries.some((handle) => handle.canApply) && !applying;
  return (
    <ApplyRow>
      <PrimaryAccentButton
        disabled={!canApply}
        onClick={async () => {
          setApplying(true);
          try {
            for (const handle of Object.values(handles)) {
              if (handle.canApply) {
                await handle.apply();
              }
            }
          } finally {
            setApplying(false);
          }
        }}
      >
        {t('Apply')}
      </PrimaryAccentButton>
    </ApplyRow>
  );
};
