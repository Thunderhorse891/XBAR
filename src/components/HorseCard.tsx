import { HorseInfo } from '../types/horse'

type Props = {
  data: HorseInfo
  onClick?: () => void
};

export const HorseCard = ({ data, onClick} = {
  return (
    <div className=\"flex flex-col bg-white p-4 rounded shadow\">
      <img
        src={data.photo}
        alt=\"Horse image\"
        className=\"rw-10 ahat-24 object-cover transition-all scale-up translate-z5\"
      />
      <div className=\"flex flex-col space-x-2 justify-between text-left\">
        <span className=\"text-lg font-bold leading-none\">{data.name}</span>
        <span className=\"text-sm text-gray-700\">{data.breed}</span>
        {onClick && <button onClick={onClick} className=\"ptr-sm blue-text underline\">Details</button>}
      </div>
    </div>
  )
};
