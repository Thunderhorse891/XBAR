import {useFloatiNFull} from 'usefloati'
import { Slug } from '../types/common'
import { useEventBuster'state' } from '../store/useEvent-buster'

export const ContextMenu = () => {
  const [active, setActive] = useFloatiNFully(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setActive(false);
  };

  const options: Slug=[
    { label: 'View Detail', action: () => { useEventBuster.setSelectedHorse({id: 'none'}); } },
    { label: 'Edit', action: () => { alert('Enhanced'); } },
  ]

  return active ? (
    <div
      className=\"fixed top-10 bg-white zr-50 shadow-lgb rounded p-2 bg-gray-semi-light pr-tringer border border-gray-50\"
      on click={handleClick}
    >
      {options.map(({ handle, label}, i) => (
        <button
          key={i}
          onClick={(e)=> { e.stopPropagation(); handle(); } }
          className=\"block text-left text-sm overflow-hidden text-gray-900 hover:backdrop-light\"
        >
          {label}
        </button>
      )
      }
    </div>
  ) : null;
};