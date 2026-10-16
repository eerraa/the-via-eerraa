import {PropsWithChildren, useCallback, useEffect, useId, useRef} from 'react';
import styled from 'styled-components';
import {AccentButton} from './accent-button';
import {ModalContainer, PromptText} from './dialog-base';
import {useTranslation} from 'react-i18next';

const MessageDialogContainer = styled.dialog`
  padding: 0;
  border-width: 0;

  background: transparent;
  &::backdrop {
    background: rgba(0, 0, 0, 0.75);
  }

  & > div {
    transition: transform 0.2s ease-out;
    transform: translateY(-20px);
  }

  &[open] > div {
    transform: translateY(0px);
  }
`;
const Controls = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
`;
export const MessageDialog: React.FC<
  PropsWithChildren<{
    isOpen: boolean;
    onConfirm?(): void;
    onCancel?(): void;
    confirmLabel?: string;
    /** A second button after Confirm, for a dialog that offers a way forward. */
    secondaryLabel?: string;
    onSecondary?(): void;
  }>
> = (props) => {
  const {t} = useTranslation();
  const promptId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const closeModal = useCallback(() => {
    if (ref.current) {
      ref.current.close();
    }
  }, [ref.current]);
  useEffect(() => {
    if (ref.current) {
      if (props.isOpen) {
        ref.current.showModal();
      } else {
        ref.current.close();
      }
    }
    return () => {
      closeModal();
    };
  }, [props.isOpen]);
  return (
    <MessageDialogContainer
      ref={ref}
      aria-describedby={promptId}
      onCancel={(evt) => {
        evt.preventDefault();
        // Escape answers like Confirm unless the dialog gives it another meaning.
        (props.onCancel ?? props.onConfirm)?.();
        closeModal();
      }}
    >
      <ModalContainer>
        <PromptText id={promptId}>{props.children}</PromptText>
        <Controls>
          <AccentButton
            onClick={() => {
              props.onConfirm?.();
              closeModal();
            }}
          >
            {t(props.confirmLabel || 'Confirm')}
          </AccentButton>
          {props.secondaryLabel && (
            <AccentButton
              onClick={() => {
                props.onSecondary?.();
                closeModal();
              }}
            >
              {t(props.secondaryLabel)}
            </AccentButton>
          )}
        </Controls>
      </ModalContainer>
    </MessageDialogContainer>
  );
};
