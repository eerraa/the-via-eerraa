import {faXmarkCircle} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {PropsWithChildren} from 'react';
import styled from 'styled-components';
import {focusRing} from 'src/components/inputs/accent-button';
import {useTranslation} from 'react-i18next';

const DeleteButton = styled.button`
  appearance: none;
  position: absolute;
  right: -5px;
  top: 6px;
  padding: 0;
  border: none;
  line-height: 1;
  color: var(--bg_icon-highlighted);
  background: var(--bg_icon);
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.8);
  transition: transform 0.2s ease-in-out;
  outline: none;
  ${focusRing}
`;

const DeletableContainer = styled.div`
  display: inline-flex;
  max-width: 100%;
  vertical-align: middle;
  position: relative;
  &:hover ${DeleteButton}, &:focus-within ${DeleteButton} {
    opacity: 1;
    transform: scale(1);
  }
`;

export const Deletable: React.FC<
  PropsWithChildren<{
    index: number;
    disabled: boolean;
    deleteItem: (index: number) => void;
  }>
> = (props) => {
  const {t} = useTranslation();
  return (
    <DeletableContainer
      data-macro-event={props.index}
      style={{pointerEvents: !props.disabled ? 'all' : 'none'}}
    >
      {props.children}
      {props.disabled ? null : (
        <DeleteButton
          type="button"
          aria-label={`${t('Delete')} ${props.index + 1}`}
          onClick={() => props.deleteItem(props.index)}
        >
          <FontAwesomeIcon icon={faXmarkCircle} size={'lg'} />
        </DeleteButton>
      )}
    </DeletableContainer>
  );
};
