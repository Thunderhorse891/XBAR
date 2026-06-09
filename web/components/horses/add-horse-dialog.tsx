'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCreateHorse } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui';

const schema = z.object({
  name: z.string().min(2, 'Name is required.'),
  breed: z.string().min(2, 'Breed is required.'),
  color: z.string().min(2, 'Color is required.'),
  sex: z.string().min(1, 'Select a sex.'),
  birthdate: z.string().min(4, 'Foaling date is required.'),
  registrationNumber: z.string().optional().default(''),
});

type FormValues = z.infer<typeof schema>;

export function AddHorseDialog() {
  const router = useRouter();
  const { addHorseOpen, setAddHorseOpen } = useUiStore();
  const createHorse = useCreateHorse();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { sex: 'Mare' } });

  const onSubmit = handleSubmit(async (values) => {
    const horse = await createHorse.mutateAsync({ ...values, registrationNumber: values.registrationNumber ?? '' });
    reset();
    setAddHorseOpen(false);
    router.push(`/horses/${horse.id}`);
  });

  return (
    <Dialog open={addHorseOpen} onOpenChange={setAddHorseOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a horse</DialogTitle>
          <DialogDescription>
            Enter the basics manually — or upload registration papers in Documents and XBAR will build the profile from OCR.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="horse-name">Horse name</Label>
            <Input id="horse-name" placeholder="Spirit of the Desert" {...register('name')} aria-invalid={Boolean(errors.name)} />
            {errors.name && <p role="alert" className="text-xs text-danger">{errors.name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="horse-breed">Breed</Label>
              <Input id="horse-breed" placeholder="Arabian" {...register('breed')} aria-invalid={Boolean(errors.breed)} />
              {errors.breed && <p role="alert" className="text-xs text-danger">{errors.breed.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="horse-color">Color</Label>
              <Input id="horse-color" placeholder="Bay" {...register('color')} aria-invalid={Boolean(errors.color)} />
              {errors.color && <p role="alert" className="text-xs text-danger">{errors.color.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="horse-sex">Sex</Label>
              <Select id="horse-sex" {...register('sex')}>
                <option>Mare</option>
                <option>Gelding</option>
                <option>Stallion</option>
                <option>Filly</option>
                <option>Colt</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="horse-birthdate">Foaled</Label>
              <Input id="horse-birthdate" type="date" {...register('birthdate')} aria-invalid={Boolean(errors.birthdate)} />
              {errors.birthdate && <p role="alert" className="text-xs text-danger">{errors.birthdate.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="horse-reg">Registration # (optional)</Label>
            <Input id="horse-reg" placeholder="AHA 0654321" {...register('registrationNumber')} />
            <p className="text-xs text-steel-muted">Used to auto-match future document uploads to this horse.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddHorseOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createHorse.isPending}>
              {createHorse.isPending ? 'Creating…' : 'Create horse'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
