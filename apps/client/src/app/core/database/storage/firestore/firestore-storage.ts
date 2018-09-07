import { Observable } from 'rxjs';
import { DataModel } from '../data-model';
import { DataStore } from '../data-store';
import { NgSerializerService } from '@kaiu/ng-serializer';
import { NgZone } from '@angular/core';
import { AngularFirestore } from 'angularfire2/firestore';
import { Action } from 'angularfire2/firestore/interfaces';
import { PendingChangesService } from '../../pending-changes/pending-changes.service';
import { fromPromise } from 'rxjs/internal/observable/fromPromise';
import { map, tap } from 'rxjs/operators';

export abstract class FirestoreStorage<T extends DataModel> extends DataStore<T> {

  protected constructor(protected firestore: AngularFirestore, protected serializer: NgSerializerService, protected zone: NgZone,
                        protected pendingChangesService: PendingChangesService) {
    super();
  }

  add(data: T, uriParams?: any): Observable<string> {
    this.pendingChangesService.addPendingChange(`add ${this.getBaseUri(uriParams)}`);
    const toAdd = JSON.parse(JSON.stringify(data));
    delete toAdd.$key;
    return fromPromise(this.firestore.collection(this.getBaseUri(uriParams)).add(toAdd))
      .pipe(
        map((ref: any) => {
          return ref.id;
        }),
        tap((uid: string) => {
          // In order to enable cache for this newly created element.
          this.get(uid);
          this.pendingChangesService.removePendingChange(`add ${this.getBaseUri(uriParams)}`);
        }));
  }

  get(uid: string, uriParams?: any): Observable<T> {
    return this.firestore.collection(this.getBaseUri(uriParams)).doc(uid).snapshotChanges()
      .pipe(
        map((snap: Action<any>) => {
          const valueWithKey: T = <T>{ $key: snap.payload.id, ...snap.payload.data() };
          if (!snap.payload.exists) {
            throw new Error(`${this.getBaseUri(uriParams)}/${uid} Not found`);
          }
          delete snap.payload;
          return this.serializer.deserialize<T>(valueWithKey, this.getClass());
        })
      );
  }

  update(uid: string, data: T, uriParams?: any): Observable<void> {
    this.pendingChangesService.addPendingChange(`update ${this.getBaseUri(uriParams)}/${uid}`);
    const toUpdate = JSON.parse(JSON.stringify(data));
    delete toUpdate.$key;
    if (uid === undefined || uid === null || uid === '') {
      throw new Error('Empty uid');
    }
    return fromPromise(this.firestore.collection(this.getBaseUri(uriParams)).doc(uid).update(toUpdate)).pipe(
      tap(() => {
        this.pendingChangesService.removePendingChange(`update ${this.getBaseUri(uriParams)}/${uid}`);
      }));
  }

  set(uid: string, data: T, uriParams?: any): Observable<void> {
    this.pendingChangesService.addPendingChange(`set ${this.getBaseUri(uriParams)}/${uid}`);
    const toSet = JSON.parse(JSON.stringify(data));
    delete toSet.$key;
    if (uid === undefined || uid === null || uid === '') {
      throw new Error('Empty uid');
    }
    return fromPromise(this.firestore.collection(this.getBaseUri(uriParams)).doc(uid).set(toSet)).pipe(
      tap(() => {
        this.pendingChangesService.removePendingChange(`set ${this.getBaseUri(uriParams)}/${uid}`);
      }));
  }

  remove(uid: string, uriParams?: any): Observable<void> {
    this.pendingChangesService.addPendingChange(`remove ${this.getBaseUri(uriParams)}/${uid}`);
    if (uid === undefined || uid === null || uid === '') {
      throw new Error('Empty uid');
    }
    return fromPromise(this.firestore.collection(this.getBaseUri(uriParams)).doc(uid).delete())
      .pipe(tap(() => {
        // If there's cache information, delete it.
        this.pendingChangesService.removePendingChange(`remove ${this.getBaseUri(uriParams)}/${uid}`);
      }));
  }

}
